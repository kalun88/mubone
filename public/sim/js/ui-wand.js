// ============================================================================
// ui-wand.js — Wand control panel
//
// Standalone modal wired to wandConfig from wand.js.
// Draws a live XY scatter (yaw × pitch), roll strip, inertial meters, and a morph bar.
// All controls write directly into wandConfig — the mapping engine picks up
// changes on the next sensor OSC message.
// ============================================================================

import { S, PRESETS } from './state.js';
import { wand, wandTare, wandClearTare } from './sensor.js';
import { wandConfig, PARAM_DEFS, PITCH_KNEE, PITCH_LIMIT, smoothedT, applyXY2D, clearWandOverrides } from './wand.js';
import { wireSaveDefaultBtn } from './ui-audio-settings.js';

// slot key A/B/C → wandConfig property name
const SLOTS = { A: 'axisA', B: 'axisB', C: 'axisC' };

// ── HiDPI canvas helper ─────────────────────────────────────────────────────
// Resizes the canvas backing store to match CSS layout × devicePixelRatio.
// Returns logical (CSS) width and height so draw code stays resolution-agnostic.
function hiDPIPrepare(ctx, canvas) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w    = Math.round(rect.width)  || canvas.width;
  const h    = Math.round(rect.height) || canvas.height;
  const bw   = Math.round(w * dpr);
  const bh   = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width  = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: w, H: h };
}

// Module-level tare callback — assigned during initWandUI, exported for keyboard shortcut.
let _doWandTare = null;
export function triggerWandTare() { _doWandTare?.(); }

// ── Init ──────────────────────────────────────────────────────────────────────
export function initWandUI() {
  const modal   = document.getElementById('wandModal');
  const openBtn = document.getElementById('wandBtn');
  const close   = document.getElementById('wandClose');
  if (!modal || !openBtn) return;

  // Expose wandConfig on S so saveAllDefaults() can reach it
  S._wandConfig = wandConfig;

  // ── Open / close ──────────────────────────────────────────────────────────
  openBtn.addEventListener('click', () => {
    modal.classList.toggle('open');
    openBtn.classList.toggle('active', modal.classList.contains('open'));
  });
  close?.addEventListener('click', () => {
    modal.classList.remove('open');
    openBtn.classList.remove('active');
  });
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.classList.remove('open');
      openBtn.classList.remove('active');
    }
  });

  // ── Populate param <select> options ──────────────────────────────────────
  const paramHTML = [
    '<option value="none">— off —</option>',
    ...Object.entries(PARAM_DEFS).map(([k, d]) =>
      `<option value="${k}">${d.label}</option>`),
  ].join('');
  modal.querySelectorAll('.wand-param-sel').forEach(sel => {
    sel.innerHTML = paramHTML;
  });

  // ── Preset option HTML (reused by morph selects below) ───────────────────
  const presetHTML = PRESETS.map((p, i) =>
    `<option value="${i}">${i}. ${p.name}</option>`).join('');

  // ── Tare buttons in wand panel + top bar ─────────────────────────────────
  // Shared helpers so all tare buttons (modal + top-bar) stay in sync.
  const tareBtnPanel      = document.getElementById('wandTareBtnPanel');
  const clearTareBtnPanel = document.getElementById('wandClearTareBtnPanel');
  const tareTopBtn        = document.getElementById('wandTareTopBtn');

  _doWandTare = () => {
    wandTare();
    tareBtnPanel?.classList.add('active');
    clearTareBtnPanel?.classList.remove('active');
    tareTopBtn?.classList.add('active');
  };
  function doWandClearTare() {
    wandClearTare();
    clearTareBtnPanel?.classList.add('active');
    tareBtnPanel?.classList.remove('active');
    tareTopBtn?.classList.remove('active');
  }

  tareBtnPanel?.addEventListener('click', _doWandTare);
  clearTareBtnPanel?.addEventListener('click', doWandClearTare);
  tareTopBtn?.addEventListener('click', _doWandTare);

  // ── Hardware axis remap ───────────────────────────────────────────────────
  // Axis buttons: which semantic euler angle this board axis maps to
  modal.querySelectorAll('.smapW-axis').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      modal.querySelectorAll(`.smapW-axis[data-phys="${phys}"]`)
        .forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      S.wandCal.axisMap[phys].viz = b.dataset.viz;
    });
  });

  // Sign buttons: +1 or −1 multiplier on this board axis
  modal.querySelectorAll('.smapW-sign').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      modal.querySelectorAll(`.smapW-sign[data-phys="${phys}"]`)
        .forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      S.wandCal.axisMap[phys].sign = b.dataset.sign === '+' ? 1 : -1;
    });
  });

  // Mute buttons: completely ignore this board axis
  modal.querySelectorAll('.smapW-mute').forEach(b => {
    b.addEventListener('click', () => {
      const phys = b.dataset.phys;
      const muted = !S.wandCal.axisMap[phys].mute;
      S.wandCal.axisMap[phys].mute = muted;
      b.classList.toggle('active', muted);
    });
  });

  // ── Mapping enable toggle ─────────────────────────────────────────────────
  const enableBtn    = document.getElementById('wandEnableBtn');
  const enableTopBtn = document.getElementById('wandEnableTopBtn');
  function syncEnable() {
    const on = wandConfig.enabled;
    enableBtn?.classList.toggle('active', on);
    if (enableBtn) enableBtn.textContent = on ? 'mapping on' : 'mapping off';
    enableTopBtn?.classList.toggle('active', on);
    if (enableTopBtn) enableTopBtn.textContent = on ? '⟆ wand on' : '⟆ wand off';
  }
  function toggleEnable() {
    wandConfig.enabled = !wandConfig.enabled;
    if (!wandConfig.enabled) clearWandOverrides();
    syncEnable();
  }
  enableBtn?.addEventListener('click', toggleEnable);
  enableTopBtn?.addEventListener('click', toggleEnable);
  syncEnable();

  // ── Axis slot controls ────────────────────────────────────────────────────
  // Selects: data-slot="A|B|C", data-field="src|param"
  modal.querySelectorAll('.wand-select[data-slot]').forEach(sel => {
    const key   = SLOTS[sel.dataset.slot];
    const field = sel.dataset.field;
    if (!key || !field) return;
    sel.value = String(wandConfig[key][field]);
    sel.addEventListener('change', () => { wandConfig[key][field] = sel.value; });
  });

  // Number inputs: data-slot, data-field="inMin|inMax"
  modal.querySelectorAll('.wand-num[data-slot]').forEach(inp => {
    const key   = SLOTS[inp.dataset.slot];
    const field = inp.dataset.field;
    if (!key || !field) return;
    inp.value = String(wandConfig[key][field]);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) wandConfig[key][field] = v;
    });
  });

  // Invert (flip) buttons
  modal.querySelectorAll('.wand-invert-btn').forEach(btn => {
    const key = SLOTS[btn.dataset.slot];
    if (!key) return;
    btn.classList.toggle('active', wandConfig[key].invert);
    btn.addEventListener('click', () => {
      wandConfig[key].invert = !wandConfig[key].invert;
      btn.classList.toggle('active', wandConfig[key].invert);
    });
  });

  // ── Gyro agitation ────────────────────────────────────────────────────────
  // Generic helpers to avoid repeating the same addEventListener pattern.
  function wireSelect(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(get());
    el.addEventListener('change', () => set(el.value));
  }
  function wireNum(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(get());
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isNaN(v)) set(v);
    });
  }

  wireSelect('wandGyroParam',     () => wandConfig.gyro.param,     v => { wandConfig.gyro.param     = v; });
  wireNum   ('wandGyroThreshold', () => wandConfig.gyro.threshold, v => { wandConfig.gyro.threshold = v; });
  wireNum   ('wandGyroMax',       () => wandConfig.gyro.maxMag,    v => { wandConfig.gyro.maxMag    = v; });
  wireNum   ('wandGyroStrength',  () => wandConfig.gyro.strength,  v => { wandConfig.gyro.strength  = v; });

  // ── Preset morph slots A / B / C ─────────────────────────────────────────
  const MORPH_KEYS = { A: 'morphA', B: 'morphB', C: 'morphC' };

  // Populate preset selects (presetA, presetB, presetC)
  // presetC uses a leading "— off —" option (value "-1"); selecting it disables center blending.
  const centerPresetHTML = '<option value="-1">— off —</option>' + presetHTML;
  modal.querySelectorAll('.wand-morph-sel').forEach(sel => {
    const isCenter = sel.dataset.field === 'presetC';
    sel.innerHTML = isCenter ? centerPresetHTML : presetHTML;
    const key   = MORPH_KEYS[sel.dataset.morph];
    const field = sel.dataset.field;   // 'presetA', 'presetB', or 'presetC'
    if (key && field) {
      sel.value = String(wandConfig[key][field]);
      sel.addEventListener('change', () => { wandConfig[key][field] = parseInt(sel.value); });
    }
  });

  // Enable toggle buttons
  modal.querySelectorAll('.wand-morph-enable').forEach(btn => {
    const key = MORPH_KEYS[btn.dataset.morph];
    if (!key) return;
    btn.classList.toggle('active', wandConfig[key].enabled);
    btn.textContent = wandConfig[key].enabled ? 'on' : 'off';
    btn.addEventListener('click', () => {
      wandConfig[key].enabled = !wandConfig[key].enabled;
      btn.classList.toggle('active', wandConfig[key].enabled);
      btn.textContent = wandConfig[key].enabled ? 'on' : 'off';
    });
  });

  // Axis selects
  modal.querySelectorAll('.wand-morph-axis').forEach(sel => {
    const key = MORPH_KEYS[sel.dataset.morph];
    if (!key) return;
    sel.value = wandConfig[key].axis;
    sel.addEventListener('change', () => { wandConfig[key].axis = sel.value; });
  });

  // inMin / inMax number inputs (data-morph + data-field)
  modal.querySelectorAll('.wand-num[data-morph]').forEach(inp => {
    const key   = MORPH_KEYS[inp.dataset.morph];
    const field = inp.dataset.field;   // 'inMin' or 'inMax'
    if (!key || !field) return;
    inp.value = String(wandConfig[key][field]);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) wandConfig[key][field] = v;
    });
  });

  // ── 2D pad ────────────────────────────────────────────────────────────────
  initXY2D(modal);

  // ── Live update loop ──────────────────────────────────────────────────────
  const xyCanvas  = document.getElementById('wandXYPlot');
  const xyCtx     = xyCanvas?.getContext('2d');
  const yawCanvas = document.getElementById('wandRollPlot');
  const yawCtx    = yawCanvas?.getContext('2d');
  const padCanvas = document.getElementById('xy2dPad');
  const padCtx    = padCanvas?.getContext('2d');

  // Restore saved wand config (if loadAudioDefaults stashed one on S)
  if (S._savedWandConfig) {
    const src = S._savedWandConfig;
    for (const key of ['enabled', 'axisA', 'axisB', 'axisC', 'gyro', 'morphA', 'morphB', 'morphC', 'xy2d']) {
      if (src[key] != null) {
        if (typeof src[key] === 'object') Object.assign(wandConfig[key], src[key]);
        else wandConfig[key] = src[key];
      }
    }
    delete S._savedWandConfig;
  }

  let _wandRafId = null;
  function tick() {
    drawXYPlot(xyCtx, xyCanvas);
    drawYawPlot(yawCtx, yawCanvas);
    updateMeters();
    updateMorphBar();
    updateEulerLive();
    drawXY2DPad(padCtx, padCanvas);
    _wandRafId = requestAnimationFrame(tick);
  }
  function startWandRAF()  { if (!_wandRafId) tick(); }
  function stopWandRAF()   { if (_wandRafId) { cancelAnimationFrame(_wandRafId); _wandRafId = null; } }

  // Start/stop RAF on modal open/close
  if (modal.classList.contains('open')) startWandRAF();
  const _obs = new MutationObserver(() => {
    if (modal.classList.contains('open')) startWandRAF(); else stopWandRAF();
  });
  _obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
}

// ── XY scatter: yaw (X-axis) × pitch (Y-axis), tare-relative ─────────────────
// Asymmetric scales: X = ±180° across full width, Y = ±90° across full height.
// Pitch is soft-clamped in wand.js (linear to PITCH_KNEE, smoothstep to
// PITCH_LIMIT).  The dead zone is visualised with shaded bands.
function drawXYPlot(ctx, canvas) {
  if (!ctx) return;
  const { W, H } = hiDPIPrepare(ctx, canvas);
  const cx = W / 2;
  const cy = H / 2;
  const sX = (W / 2) / 180;   // px per degree — yaw:  ±180° fills width
  const sY = (H / 2) / 90;    // px per degree — pitch: ±90° fills height

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, W, H);

  // ── Dead zone bands (pitch) ─────────────────────────────────────────────
  // Soft zone: PITCH_KNEE → PITCH_LIMIT — smoothstep saturation region
  // Lock zone: PITCH_LIMIT → ±90°       — effectively frozen
  const yKnee  = cy - PITCH_KNEE  * sY;
  const yLimit = cy - PITCH_LIMIT * sY;
  // top soft zone
  ctx.fillStyle = 'rgba(232,160,48,0.07)';
  ctx.fillRect(0, yLimit, W, yKnee - yLimit);
  // top lock zone
  ctx.fillStyle = 'rgba(232,100,48,0.10)';
  ctx.fillRect(0, 0, W, yLimit);
  // bottom (mirror)
  const yKneeB  = cy + PITCH_KNEE  * sY;
  const yLimitB = cy + PITCH_LIMIT * sY;
  ctx.fillStyle = 'rgba(232,160,48,0.07)';
  ctx.fillRect(0, yKneeB, W, yLimitB - yKneeB);
  ctx.fillStyle = 'rgba(232,100,48,0.10)';
  ctx.fillRect(0, yLimitB, W, H - yLimitB);

  // Cap lines at PITCH_LIMIT
  ctx.strokeStyle = 'rgba(232,140,48,0.25)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, yLimit);  ctx.lineTo(W, yLimit);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, yLimitB); ctx.lineTo(W, yLimitB); ctx.stroke();
  ctx.setLineDash([]);

  // ── Background grid ─────────────────────────────────────────────────────
  ctx.lineWidth = 1;
  // Vertical (yaw): ±45°, ±90°, ±135°, ±180°
  for (const deg of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    const alpha = (deg % 90 === 0) ? 0.10 : 0.04;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    const px = cx + deg * sX;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
  // Horizontal (pitch): ±30°, ±60°, ±90°
  for (const deg of [-90, -60, -30, 0, 30, 60, 90]) {
    const alpha = (deg % 90 === 0) ? 0.10 : 0.04;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    const py = cy - deg * sY;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }

  // ── Range highlights for active axis slots ──────────────────────────────
  for (const slot of [wandConfig.axisA, wandConfig.axisB, wandConfig.axisC]) {
    if (slot.param === 'none') continue;
    ctx.fillStyle = 'rgba(122,188,188,0.10)';
    if (slot.src === 'yaw') {
      const x1 = cx + slot.inMin * sX;
      const x2 = cx + slot.inMax * sX;
      ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H);
    } else if (slot.src === 'pitch') {
      const y1 = cy - slot.inMin * sY;
      const y2 = cy - slot.inMax * sY;
      ctx.fillRect(0, Math.min(y1, y2), W, Math.abs(y2 - y1));
    }
  }

  // ── Morph range highlights ───────────────────────────────────────────────
  for (const m of [wandConfig.morphA, wandConfig.morphB, wandConfig.morphC]) {
    if (!m.enabled) continue;
    ctx.fillStyle = 'rgba(232,160,48,0.12)';
    if (m.axis === 'yaw') {
      const x1 = cx + m.inMin * sX;
      const x2 = cx + m.inMax * sX;
      ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H);
    } else if (m.axis === 'pitch') {
      const y1 = cy - m.inMin * sY;
      const y2 = cy - m.inMax * sY;
      ctx.fillRect(0, Math.min(y1, y2), W, Math.abs(y2 - y1));
    }
  }

  // ── Crosshair ───────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

  // ── Position dot ────────────────────────────────────────────────────────
  if (wand.zeroEuler) {
    const dotX = Math.max(3, Math.min(W - 3, cx + wand.zeroEuler.z * sX));
    const dotY = Math.max(3, Math.min(H - 3, cy - wand.zeroEuler.y * sY));
    ctx.shadowBlur  = 8;
    ctx.shadowColor = '#7abcbc';
    ctx.fillStyle   = '#7abcbc';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;
  }
}

// ── Roll strip: horizontal bar, ±180° range ───────────────────────────────────
function drawYawPlot(ctx, canvas) {
  if (!ctx) return;
  const { W, H } = hiDPIPrepare(ctx, canvas);
  const cx = W / 2;
  const cy = H / 2;
  const scale = (W / 2) / 180;   // same scale as XY plot

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, W, H);

  // Grid lines at ±45°, ±90°, ±135°
  ctx.lineWidth = 1;
  for (const deg of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    const alpha = (deg % 90 === 0) ? 0.10 : 0.04;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    const px = cx + deg * scale;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }

  // Slot range highlights (teal) for roll-mapped slots
  for (const slot of [wandConfig.axisA, wandConfig.axisB, wandConfig.axisC]) {
    if (slot.param === 'none' || slot.src !== 'roll') continue;
    ctx.fillStyle = 'rgba(122,188,188,0.15)';
    const x1 = cx + slot.inMin * scale;
    const x2 = cx + slot.inMax * scale;
    ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H);
  }

  // Morph range highlights (amber) for any morph slot using roll
  for (const m of [wandConfig.morphA, wandConfig.morphB, wandConfig.morphC]) {
    if (!m.enabled || m.axis !== 'roll') continue;
    ctx.fillStyle = 'rgba(232,160,48,0.15)';
    const x1 = cx + m.inMin * scale;
    const x2 = cx + m.inMax * scale;
    ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H);
  }

  // Center crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();

  // Roll position dot
  if (wand.zeroEuler) {
    const dotX = Math.max(4, Math.min(W - 4, cx + wand.zeroEuler.x * scale));
    ctx.shadowBlur  = 7;
    ctx.shadowColor = '#7abcbc';
    ctx.fillStyle   = '#7abcbc';
    ctx.beginPath();
    ctx.arc(dotX, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;
  }
}

// ── Inertial meters ───────────────────────────────────────────────────────────
function updateMeters() {
  const gyroBar  = document.getElementById('wandGyroBar');
  const gyroVal  = document.getElementById('wandGyroVal');
  const accelBar = document.getElementById('wandAccelBar');
  const accelVal = document.getElementById('wandAccelVal');

  if (wand.inertial) {
    const gyroFull = Math.max(wandConfig.gyro.maxMag, 1);
    if (gyroBar)  gyroBar.style.width  = Math.min(100, (wand.inertial.gyroMag     / gyroFull) * 100) + '%';
    if (gyroVal)  gyroVal.textContent  = wand.inertial.gyroMag.toFixed(0) + ' °/s';
    if (accelBar) accelBar.style.width = Math.min(100, (wand.inertial.accelDynMag / 3) * 100) + '%';
    if (accelVal) accelVal.textContent = wand.inertial.accelDynMag.toFixed(2) + ' g';
  } else {
    if (gyroBar)  gyroBar.style.width  = '0%';
    if (gyroVal)  gyroVal.textContent  = '—';
    if (accelBar) accelBar.style.width = '0%';
    if (accelVal) accelVal.textContent = '—';
  }
}

// ── Morph position cursors (one per slot A/B/C) ───────────────────────────────
// Reads smoothedT from wand.js so the cursor tracks the actual smoothed value
// that the engine is using, not the raw sensor reading.
function updateMorphBar() {
  const MORPH_KEYS = { A: 'morphA', B: 'morphB', C: 'morphC' };
  for (const [letter, key] of Object.entries(MORPH_KEYS)) {
    const cursor = document.getElementById(`wandMorphCursor${letter}`);
    if (!cursor) continue;
    const m = wandConfig[key];
    if (!m.enabled || !wand.zeroEuler) {
      cursor.style.opacity = '0';
      continue;
    }
    cursor.style.opacity = '1';
    const t = smoothedT[key] ?? 0;
    cursor.style.left = (Math.max(0, Math.min(1, t)) * 100) + '%';
  }
}

// ── Euler live readout ────────────────────────────────────────────────────────
function updateEulerLive() {
  const el = document.getElementById('wandEulerLive');
  if (!el) return;
  if (wand.zeroEuler) {
    const { x: roll, y: pitch, z: yaw } = wand.zeroEuler;
    el.innerHTML =
      `pitch <span>${pitch.toFixed(1)}°</span>  ` +
      `roll <span>${roll.toFixed(1)}°</span>  ` +
      `yaw <span>${yaw.toFixed(1)}°</span>`;
  } else {
    el.innerHTML = 'no data';
  }
}

// ── 2D bilinear pad ───────────────────────────────────────────────────────────

function initXY2D(modal) {
  const presetHTML = () => PRESETS.map((p, i) =>
    `<option value="${i}">${i + 1}. ${p.name}</option>`).join('');

  // Populate all five preset selects (4 corners + center)
  for (const id of ['xy2dTL', 'xy2dTR', 'xy2dC', 'xy2dBL', 'xy2dBR']) {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = presetHTML();
  }
  const corners = {
    xy2dTL: 'presetTL', xy2dTR: 'presetTR',
    xy2dC:  'presetC',
    xy2dBL: 'presetBL', xy2dBR: 'presetBR',
  };
  const defaults = { xy2dTL: 0, xy2dTR: 1, xy2dC: 4, xy2dBL: 2, xy2dBR: 3 };
  for (const [id, field] of Object.entries(corners)) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.value = wandConfig.xy2d[field] ?? defaults[id];
    sel.addEventListener('change', () => { wandConfig.xy2d[field] = parseInt(sel.value); });
  }

  // Enable toggle
  const enableBtn = document.getElementById('xy2dEnableBtn');
  function syncEnableBtn() {
    if (!enableBtn) return;
    enableBtn.textContent = wandConfig.xy2d.enabled ? 'on' : 'off';
    enableBtn.classList.toggle('active', wandConfig.xy2d.enabled);
  }
  enableBtn?.addEventListener('click', () => {
    wandConfig.xy2d.enabled = !wandConfig.xy2d.enabled;
    syncEnableBtn();
  });
  syncEnableBtn();

  // Axis selects + range inputs
  const axisFields = [
    { selId: 'xy2dAxisX', minId: 'xy2dXMin', maxId: 'xy2dXMax', axisKey: 'axisX', minKey: 'xMin', maxKey: 'xMax' },
    { selId: 'xy2dAxisY', minId: 'xy2dYMin', maxId: 'xy2dYMax', axisKey: 'axisY', minKey: 'yMin', maxKey: 'yMax' },
  ];
  for (const { selId, minId, maxId, axisKey, minKey, maxKey } of axisFields) {
    const sel = document.getElementById(selId);
    const minEl = document.getElementById(minId);
    const maxEl = document.getElementById(maxId);
    if (sel) {
      sel.value = wandConfig.xy2d[axisKey];
      sel.addEventListener('change', () => { wandConfig.xy2d[axisKey] = sel.value; });
    }
    if (minEl) {
      minEl.value = wandConfig.xy2d[minKey];
      minEl.addEventListener('change', () => { wandConfig.xy2d[minKey] = parseFloat(minEl.value); });
    }
    if (maxEl) {
      maxEl.value = wandConfig.xy2d[maxKey];
      maxEl.addEventListener('change', () => { wandConfig.xy2d[maxKey] = parseFloat(maxEl.value); });
    }
  }

  // Mouse / touch drag on the pad for manual control
  const pad = document.getElementById('xy2dPad');
  if (!pad) return;
  let _dragging = false;

  function padPosFromEvent(e) {
    const rect = pad.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const tx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ty = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)); // flip Y
    return { tx, ty };
  }

  function handleDrag(e) {
    if (!_dragging) return;
    e.preventDefault();
    const { tx, ty } = padPosFromEvent(e);
    wandConfig.xy2d.manualX = tx;
    wandConfig.xy2d.manualY = ty;
    // In manual mode (or when wand not driving), apply immediately
    if (wandConfig.xy2d.enabled &&
        (wandConfig.xy2d.axisX === 'manual' || wandConfig.xy2d.axisY === 'manual' || !wandConfig.enabled)) {
      applyXY2D(tx, ty);
    }
  }

  pad.addEventListener('mousedown',  e => { _dragging = true; handleDrag(e); });
  pad.addEventListener('touchstart', e => { _dragging = true; handleDrag(e); }, { passive: false });
  window.addEventListener('mousemove',  handleDrag);
  window.addEventListener('touchmove',  handleDrag, { passive: false });
  window.addEventListener('mouseup',  () => { _dragging = false; });
  window.addEventListener('touchend', () => { _dragging = false; });
}

// ── Draw the 2D pad canvas ────────────────────────────────────────────────────
function drawXY2DPad(ctx, canvas) {
  if (!ctx) return;
  const { W, H } = hiDPIPrepare(ctx, canvas);
  const c = wandConfig.xy2d;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = wandConfig.xy2d.enabled ? '#1a1a22' : '#181818';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

  // Center weight at current position — used to tint the center marker
  const tx0 = (c.axisX !== 'manual' && smoothedT['xy2d_x'] !== undefined) ? smoothedT['xy2d_x'] : c.manualX;
  const ty0 = (c.axisY !== 'manual' && smoothedT['xy2d_y'] !== undefined) ? smoothedT['xy2d_y'] : c.manualY;
  const wCenter = (1 - Math.abs(2 * tx0 - 1)) * (1 - Math.abs(2 * ty0 - 1));

  // Center diamond marker — glows with center weight
  const cAlpha = 0.15 + wCenter * 0.45;
  ctx.strokeStyle = `rgba(232,160,48,${cAlpha})`;
  ctx.lineWidth = 1;
  const diam = 10;
  ctx.beginPath();
  ctx.moveTo(W / 2,        H / 2 - diam);
  ctx.lineTo(W / 2 + diam, H / 2);
  ctx.lineTo(W / 2,        H / 2 + diam);
  ctx.lineTo(W / 2 - diam, H / 2);
  ctx.closePath();
  ctx.stroke();

  // Labels: 4 corners + center
  ctx.font = '10px Inter, sans-serif';
  const labels = [
    { field: 'presetTL', x: 6,     y: 14,        ax: 'left'   },
    { field: 'presetTR', x: W - 6, y: 14,        ax: 'right'  },
    { field: 'presetC',  x: W / 2, y: H / 2 - 14, ax: 'center' },
    { field: 'presetBL', x: 6,     y: H - 6,     ax: 'left'   },
    { field: 'presetBR', x: W - 6, y: H - 6,     ax: 'right'  },
  ];
  for (const { field, x, y, ax } of labels) {
    const idx  = Math.max(0, Math.min(PRESETS.length - 1, c[field]));
    const name = PRESETS[idx]?.name ?? '—';
    ctx.textAlign  = ax;
    // Center label brightens with wCenter
    ctx.fillStyle  = field === 'presetC'
      ? `rgba(232,160,48,${0.25 + wCenter * 0.55})`
      : 'rgba(255,255,255,0.30)';
    ctx.fillText(name, x, y);
  }

  // Dot position — tx0/ty0 already computed above for center weight
  const dotX = tx0 * W;
  const dotY = (1 - ty0) * H;   // flip Y: ty=1 → top of canvas

  // Faint crosshair from dot to edges
  ctx.strokeStyle = 'rgba(122,188,188,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(dotX, 0); ctx.lineTo(dotX, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, dotY); ctx.lineTo(W, dotY); ctx.stroke();

  // Dot
  const active = c.enabled;
  ctx.shadowBlur  = active ? 12 : 4;
  ctx.shadowColor = active ? '#7abcbc' : '#556666';
  ctx.fillStyle   = active ? '#7abcbc' : '#445555';
  ctx.beginPath();
  ctx.arc(dotX, dotY, active ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Border
  ctx.strokeStyle = active ? 'rgba(122,188,188,0.25)' : 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
