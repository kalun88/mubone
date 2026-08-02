// ============================================================================
// app.js — page controller for the Joy-Con GUI
//
// Wires:
//   joyConManager (WebHID)  →  [calibration + mapping]  →  OSCClient (WS)
//   UI events (sliders, checkboxes, buttons)  →  state + LED/rumble
//   Live readouts (stick dot, button highlight, IMU numbers, OSC log)
// ============================================================================

import { joyConManager } from './driver.js';
import { OSCClient } from './osc-client.js';
import { Mapping, BUTTONS, normalizeAddr, parseValues } from './mapping.js';

// ── DOM handles ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  pair:            $('pairBtn'),
  deviceStatus:    $('deviceStatus'),
  wsStatus:        $('wsStatus'),
  stickCanvas:     $('stickCanvas'),
  stickRaw:        $('stickRaw'),
  stickCal:        $('stickCal'),
  deadzone:        $('deadzone'),
  deadzoneVal:     $('deadzoneVal'),
  invertX:         $('invertX'),
  invertY:         $('invertY'),
  calibrateBtn:    $('calibrateBtn'),
  centerVal:       $('centerVal'),
  emitStick:       $('emitStick'),
  stickSide:       $('stickSide'),
  stickSide2:      $('stickSide2'),
  mappingRows:     $('mappingRows'),
  exportMap:       $('exportMap'),
  importMap:       $('importMap'),
  resetMap:        $('resetMap'),
  accelVal:        $('accelVal'),
  gyroVal:         $('gyroVal'),
  emitInertial:    $('emitInertial'),
  inertialName:    $('inertialName'),
  ledSolidRow:     $('ledSolidRow'),
  ledBlinkRow:     $('ledBlinkRow'),
  homeOn:          $('homeOn'),
  homeOff:         $('homeOff'),
  homePulse:       $('homePulse'),
  rLo:  $('rLo'),  rLoV:  $('rLoV'),
  rHi:  $('rHi'),  rHiV:  $('rHiV'),
  rAmp: $('rAmp'), rAmpV: $('rAmpV'),
  rDur: $('rDur'), rDurV: $('rDurV'),
  rumbleFire:      $('rumbleFire'),
  rumbleStop:      $('rumbleStop'),
  oscLog:          $('oscLog'),
  logStick:        $('logStick'),
  logInertial:     $('logInertial'),
  clearLog:        $('clearLog'),
  sentCount:       $('sentCount'),
  recvCount:       $('recvCount'),
};

// ── State ───────────────────────────────────────────────────────────────────

const state = {
  side: 'R',
  stick: {
    centerX: 2048,
    centerY: 2048,
    halfRange: 1700,   // empirical; refined after first calibration
    deadzone: parseFloat(localStorage.getItem('jc.deadzone') ?? '0.08'),
    invertX: localStorage.getItem('jc.invertX') === '1',
    invertY: localStorage.getItem('jc.invertY') !== '0',
    lastX: 0, lastY: 0,
  },
  buttons: {},    // id → bool (last-known)
  prevButtons: {},
  paired: false,
  ledMask: 0,
  blinkMask: 0,
};

// Restore saved stick calibration if present
try {
  const saved = JSON.parse(localStorage.getItem('jc.stickCal') || 'null');
  if (saved && Number.isFinite(saved.cx) && Number.isFinite(saved.cy)) {
    state.stick.centerX = saved.cx;
    state.stick.centerY = saved.cy;
  }
} catch {}

const mapping = new Mapping();
const osc = new OSCClient();

// ── OSC status ─────────────────────────────────────────────────────────────

osc.addEventListener('open',  () => setWsStatus(true));
osc.addEventListener('close', () => setWsStatus(false));
osc.addEventListener('sent',  (e) => { logOSC('→', e.detail.address, e.detail.values); dom.sentCount.textContent = osc.sentCount; });
osc.addEventListener('message', (e) => { logOSC('←', e.detail.address, e.detail.values); dom.recvCount.textContent = osc.recvCount; });
osc.connect();

function setWsStatus(ok) {
  dom.wsStatus.textContent = ok ? 'Relay: connected' : 'Relay: disconnected';
  dom.wsStatus.className = 'pill ' + (ok ? 'pill-on' : 'pill-off');
}

// ── Stick panel ────────────────────────────────────────────────────────────

dom.deadzone.value = state.stick.deadzone;
dom.deadzoneVal.textContent = state.stick.deadzone.toFixed(3);
dom.invertX.checked = state.stick.invertX;
dom.invertY.checked = state.stick.invertY;
updateCenterLabel();

dom.deadzone.addEventListener('input', () => {
  state.stick.deadzone = parseFloat(dom.deadzone.value);
  dom.deadzoneVal.textContent = state.stick.deadzone.toFixed(3);
  localStorage.setItem('jc.deadzone', String(state.stick.deadzone));
});
dom.invertX.addEventListener('change', () => {
  state.stick.invertX = dom.invertX.checked;
  localStorage.setItem('jc.invertX', state.stick.invertX ? '1' : '0');
});
dom.invertY.addEventListener('change', () => {
  state.stick.invertY = dom.invertY.checked;
  localStorage.setItem('jc.invertY', state.stick.invertY ? '1' : '0');
});
dom.calibrateBtn.addEventListener('click', () => {
  const ext = joyConManager.get(state.side);
  if (!ext) return;
  // Use most recent raw stick sample if available.
  if (state._lastRawStick) {
    state.stick.centerX = state._lastRawStick.x;
    state.stick.centerY = state._lastRawStick.y;
    localStorage.setItem('jc.stickCal', JSON.stringify({
      cx: state.stick.centerX, cy: state.stick.centerY,
    }));
    updateCenterLabel();
  }
});
function updateCenterLabel() {
  dom.centerVal.textContent = `${state.stick.centerX},${state.stick.centerY}`;
}

// ── Button panel + mapping table ───────────────────────────────────────────

function renderMapping() {
  const rows = BUTTONS
    .filter((b) => b.side === state.side)
    .map((b) => {
      const m = mapping.get(b.id);
      const defaultAddr = `/joycon/${state.side}/button/${b.id}`;
      return `
        <tr data-btn="${b.id}">
          <td>${b.label}</td>
          <td><code>${defaultAddr}</code></td>
          <td><input type="text" data-field="aliasAddr"  value="${escapeAttr(m.aliasAddr)}"  placeholder="/preset"></td>
          <td><input type="text" data-field="aliasValue" value="${escapeAttr(m.aliasValue)}" placeholder="1"></td>
          <td>
            <select data-field="aliasMode">
              <option value="press" ${m.aliasMode === 'press' ? 'selected' : ''}>press</option>
              <option value="hold"  ${m.aliasMode === 'hold'  ? 'selected' : ''}>hold</option>
              <option value="off"   ${m.aliasMode === 'off'   ? 'selected' : ''}>off</option>
            </select>
          </td>
        </tr>`;
    }).join('');
  dom.mappingRows.innerHTML = rows;

  dom.mappingRows.addEventListener('input',  onMappingInput);
  dom.mappingRows.addEventListener('change', onMappingInput);
}

function onMappingInput(ev) {
  const el = ev.target;
  const field = el.dataset.field;
  if (!field) return;
  const tr = el.closest('tr[data-btn]');
  if (!tr) return;
  mapping.set(tr.dataset.btn, { [field]: el.value });
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

dom.exportMap.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(mapping.export(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mubone-joycon-mapping.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

dom.importMap.addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (mapping.import(obj)) renderMapping();
    } catch (e) { console.warn('bad mapping file', e); }
  };
  input.click();
});
dom.resetMap.addEventListener('click', () => { mapping.reset(); renderMapping(); });

renderMapping();

// ── IMU panel ─────────────────────────────────────────────────────────────

// Nothing to wire beyond the checkbox + text field; emission happens in _onInput.

// ── LED panel ─────────────────────────────────────────────────────────────

dom.ledSolidRow.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!el.dataset.led) return;
  const i = +el.dataset.led;
  if (el.checked) state.ledMask |= (1 << i);
  else            state.ledMask &= ~(1 << i);
  flushLEDs();
});
dom.ledBlinkRow.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!el.dataset.blink) return;
  const i = +el.dataset.blink;
  if (el.checked) state.blinkMask |= (1 << i);
  else            state.blinkMask &= ~(1 << i);
  flushLEDs();
});
async function flushLEDs() {
  const ext = joyConManager.get(state.side);
  if (!ext) return;
  try { await ext.setLEDs(state.ledMask, state.blinkMask); } catch (e) { console.warn(e); }
}

dom.homeOn.addEventListener ('click', () => joyConManager.get(state.side)?.setHomeLED(true).catch(noop));
dom.homeOff.addEventListener('click', () => joyConManager.get(state.side)?.setHomeLED(false).catch(noop));
dom.homePulse.addEventListener('click', () => {
  joyConManager.get(state.side)?.setHomeLEDPattern(2, 3, 0, [
    { intensity: 0,  fadeDuration: 10, duration: 5 },
    { intensity: 15, fadeDuration: 10, duration: 5 },
    { intensity: 0,  fadeDuration: 10, duration: 5 },
  ]).catch(noop);
});

// ── Rumble panel ─────────────────────────────────────────────────────────

const bindRumble = (slider, value, fmt = (v) => v) => {
  const upd = () => value.textContent = fmt(slider.value);
  slider.addEventListener('input', upd);
  upd();
};
bindRumble(dom.rLo,  dom.rLoV);
bindRumble(dom.rHi,  dom.rHiV);
bindRumble(dom.rAmp, dom.rAmpV, (v) => Number(v).toFixed(2));
bindRumble(dom.rDur, dom.rDurV);

dom.rumbleFire.addEventListener('click', async () => {
  const ext = joyConManager.get(state.side);
  if (!ext) return;
  const lo  = +dom.rLo.value;
  const hi  = +dom.rHi.value;
  const amp = +dom.rAmp.value;
  const dur = +dom.rDur.value;
  try {
    await ext.rumble(lo, hi, amp);
    setTimeout(() => ext.stopRumble().catch(noop), dur);
  } catch (e) { console.warn('rumble failed:', e); }
});
dom.rumbleStop.addEventListener('click', () => {
  joyConManager.get(state.side)?.stopRumble().catch(noop);
});

// ── OSC log ─────────────────────────────────────────────────────────────

dom.clearLog.addEventListener('click', () => { dom.oscLog.innerHTML = ''; });

const LOG_MAX = 200;
function logOSC(arrow, addr, values) {
  // Filter firehose: stick + inertial default off
  if (addr.includes('/stick') && !dom.logStick.checked) return;
  if (addr.includes('/inertial') && !dom.logInertial.checked) return;
  if (addr.includes('/quaternion') && !dom.logInertial.checked) return;

  const row = document.createElement('div');
  row.className = 'row';
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, second: '2-digit', fractionalSecondDigits: 3 });
  row.innerHTML = `<span class="ts">${arrow} ${ts}</span><span><span class="addr">${addr}</span> <span class="val">${values.map(fmtVal).join(' ')}</span></span>`;
  dom.oscLog.appendChild(row);
  while (dom.oscLog.childElementCount > LOG_MAX) dom.oscLog.firstChild.remove();
  dom.oscLog.scrollTop = dom.oscLog.scrollHeight;
}
function fmtVal(v) {
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(3);
  return String(v);
}

// ── Pair button ─────────────────────────────────────────────────────────

dom.pair.addEventListener('click', async () => {
  try {
    await joyConManager.pair();
  } catch (e) {
    console.warn('pair cancelled/failed', e);
  }
});

// ── Device lifecycle ────────────────────────────────────────────────────

joyConManager.addEventListener('connect', async (e) => {
  const { side, extras } = e.detail;
  state.paired = true;
  state.side = side;  // prefer whichever was paired; if both, right wins if it's there
  if (joyConManager.get('R')) state.side = 'R';
  dom.deviceStatus.textContent = `Connected: ${extras.productName}`;
  dom.deviceStatus.className = 'pill pill-on';
  dom.stickSide.textContent = state.side;
  dom.stickSide2.textContent = state.side;
  renderMapping();

  // Ask vendor driver to enable full report + IMU (it does this in
  // connectDevice() anyway, but be defensive for manually-connected devices).
  try {
    await extras.joyCon.enableStandardFullMode?.();
    await extras.joyCon.enableIMUMode?.();
  } catch {}
});

joyConManager.addEventListener('disconnect', (e) => {
  if (!joyConManager.bySide.size) {
    state.paired = false;
    dom.deviceStatus.textContent = 'No controller';
    dom.deviceStatus.className = 'pill pill-off';
  }
});

// ── Input stream → UI + OSC ────────────────────────────────────────────

joyConManager.addEventListener('input', (ev) => {
  const d = ev.detail;
  if (d.side !== state.side) return;  // only process active side
  const raw = d.stickRawR && state.side === 'R' ? d.stickRawR :
              d.stickRawL && state.side === 'L' ? d.stickRawL : null;
  if (raw) {
    state._lastRawStick = raw;
    handleStick(raw);
  }
  handleButtons(d.buttons);
  handleIMU(d);
});

function handleStick(raw) {
  // Calibrate: center-subtract, scale to -1..1, deadzone, optional invert.
  let nx = (raw.x - state.stick.centerX) / state.stick.halfRange;
  let ny = (raw.y - state.stick.centerY) / state.stick.halfRange;
  if (state.stick.invertX) nx = -nx;
  if (state.stick.invertY) ny = -ny;
  // clamp
  nx = Math.max(-1, Math.min(1, nx));
  ny = Math.max(-1, Math.min(1, ny));

  // Radial deadzone
  const mag = Math.hypot(nx, ny);
  let cx = nx, cy = ny;
  if (mag < state.stick.deadzone) {
    cx = 0; cy = 0;
  } else {
    const scale = (mag - state.stick.deadzone) / (1 - state.stick.deadzone) / mag;
    cx = nx * scale; cy = ny * scale;
  }

  dom.stickRaw.textContent = `x=${raw.x} y=${raw.y}`;
  dom.stickCal.textContent = `x=${cx.toFixed(3)} y=${cy.toFixed(3)}`;
  drawStick(cx, cy);

  // OSC: emit only if moved meaningfully (saves bandwidth)
  if (dom.emitStick.checked) {
    const dx = Math.abs(cx - state.stick.lastX);
    const dy = Math.abs(cy - state.stick.lastY);
    if (dx > 0.0015 || dy > 0.0015 || (cx === 0 && state.stick.lastX !== 0) || (cy === 0 && state.stick.lastY !== 0)) {
      osc.send(`/joycon/${state.side}/stick`, cx, cy);
      osc.send(`/joycon/${state.side}/stick/x`, cx);
      osc.send(`/joycon/${state.side}/stick/y`, cy);
      state.stick.lastX = cx;
      state.stick.lastY = cy;
    }
  }
}

function handleButtons(buttons) {
  // Mark pressed rows in the UI, fire OSC on edges.
  //
  // Emission policy: alias replaces default.  If the user has configured
  // an alias (non-empty address, mode !== 'off') that alias is the only
  // thing emitted for the button.  If no alias is set, the canonical
  // /joycon/<side>/button/<id> 0|1 default fires so the button is still
  // visible in the OSC monitor — useful while deciding what to map it to.
  // This avoids doubling traffic on every mapped press.
  for (const b of BUTTONS) {
    if (b.side !== state.side) continue;
    const now  = !!buttons[b.id];
    const prev = !!state.prevButtons[b.id];
    if (now !== prev) {
      const tr = dom.mappingRows.querySelector(`tr[data-btn="${b.id}"]`);
      if (tr) tr.classList.toggle('is-pressed', now);

      const m = mapping.get(b.id);
      const aliasAddr = normalizeAddr(m.aliasAddr);
      const hasAlias  = !!aliasAddr && m.aliasMode !== 'off';

      if (hasAlias) {
        // Alias replaces default — only the mapped address goes out.
        const vals = parseValues(m.aliasValue);
        if (m.aliasMode === 'press' && now) osc.send(aliasAddr, ...vals);
        if (m.aliasMode === 'hold')         osc.send(aliasAddr, now ? 1 : 0, ...vals);
      } else {
        // No alias → emit canonical default so the button is discoverable.
        osc.send(`/joycon/${state.side}/button/${b.id}`, now ? 1 : 0);
      }
    }
  }
  state.prevButtons = { ...buttons };
}

function handleIMU(d) {
  if (!d.accel?.length || !d.gyroDps?.length) return;
  // UI readout: average the 3 sub-frames for stability
  const avg = (arr) => {
    const s = arr.reduce((acc, f) => [acc[0]+f[0], acc[1]+f[1], acc[2]+f[2]], [0,0,0]);
    return [s[0]/arr.length, s[1]/arr.length, s[2]/arr.length];
  };
  const a = avg(d.accel);
  const g = avg(d.gyroDps);
  dom.accelVal.textContent = `${a[0].toFixed(2)}, ${a[1].toFixed(2)}, ${a[2].toFixed(2)}`;
  dom.gyroVal.textContent  = `${g[0].toFixed(1)}, ${g[1].toFixed(1)}, ${g[2].toFixed(1)}`;

  if (dom.emitInertial.checked) {
    // Convert g → m/s² and deg/s → rad/s to match mubone /sensor/*/inertial convention.
    const name = (dom.inertialName.value || 'joyconR').replace(/\s/g, '');
    const G2MS2 = 9.80665;
    const D2R   = Math.PI / 180;
    // mubone's handleOSCSensorInertial expects: gx, gy, gz, ax, ay, az
    // (gyro first). See muboneapp/js/imu-setup.js.
    osc.send(`/sensor/${name}/inertial`,
      g[0] * D2R,   g[1] * D2R,   g[2] * D2R,
      a[0] * G2MS2, a[1] * G2MS2, a[2] * G2MS2);
  }
}

// ── Stick canvas viz ──────────────────────────────────────────────────

(function initStickCanvas() {
  const c = dom.stickCanvas;
  const ctx = c.getContext('2d');
  const R = c.width / 2;
  function draw(cx, cy) {
    ctx.clearRect(0, 0, c.width, c.height);
    // outer ring
    ctx.strokeStyle = '#444';
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.stroke();
    // crosshair
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, R); ctx.lineTo(c.width, R);
    ctx.moveTo(R, 0); ctx.lineTo(R, c.height);
    ctx.stroke();
    // deadzone
    ctx.strokeStyle = '#2e4555';
    ctx.beginPath(); ctx.arc(R, R, R * state.stick.deadzone, 0, Math.PI * 2); ctx.stroke();
    // dot
    const dotR = R * 0.85;
    const px = R + cx * dotR;
    const py = R - cy * dotR;  // canvas y is down; stick cy up = up on screen
    ctx.fillStyle = '#8bd3ff';
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    // trail
    ctx.strokeStyle = '#8bd3ff55';
    ctx.beginPath(); ctx.moveTo(R, R); ctx.lineTo(px, py); ctx.stroke();
  }
  // expose as global-ish for handleStick
  window.__stickDraw = draw;
  draw(0, 0);
})();
function drawStick(cx, cy) { window.__stickDraw(cx, cy); }

// ── Misc ──────────────────────────────────────────────────────────────

function noop() {}

// Stop rumble if the user navigates away mid-pulse.
window.addEventListener('beforeunload', () => {
  for (const ext of joyConManager.bySide.values()) {
    ext.stopRumble().catch(noop);
  }
});
