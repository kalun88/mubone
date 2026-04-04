// ============================================================================
// ui-imu-setup.js — x-IMU3 mounting setup modal (per-device cards)
//
// Builds dynamic device cards for each connected x-IMU3.  Each card shows:
//   • axes alignment dropdown (hardware — sent to sensor)
//   • raw Euler readout
//   • polarity toggles + calibrated output
//   • tare capture / clear
//   • role dropdown (cursor / frame / gesture)
//   • feed-to-sphere toggle
//
// Discovery list at the top shows all visible devices with connect/disconnect.
// ============================================================================

import { S, DEBUG } from './state.js';
import {
  initIMUSetup,
  getDiscovered, getSerialPorts, getDevices, getDevice,
  connectDevice, connectSerialDevice, disconnectDevice,
  scanSerialPorts,
  setAxesAlignment, togglePolarity, toggleRollMute,
  captureTare, clearTare,
  requestEulerMode, requestQuatMode,
  setFeeding, setRole,
  setOnDeviceDiscovered, setOnSerialPortsChanged, setOnDeviceUpdated,
  setOnDataReceived, setOnCommandResponse,
  sendCommandTo,
  AXES_ALIGNMENTS,
  getAlignmentLabel,
} from './imu-setup.js';

let _modal       = null;
let _rafId       = null;
let _initialized = false;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initIMUSetupUI() {
  initIMUSetup();

  _modal = document.getElementById('imuSetupModal');
  if (!_modal) return;

  const btn    = document.getElementById('imuSetupBtn');
  const close  = document.getElementById('imuSetupClose');
  const rescan = document.getElementById('imuSetupSerialRescan');

  btn?.addEventListener('click', () => {
    _modal.classList.add('open');
    onOpen();
  });
  close?.addEventListener('click', () => {
    _modal.classList.remove('open');
    onClose();
  });
  rescan?.addEventListener('click', () => {
    scanSerialPorts();
  });
  _modal.addEventListener('click', e => {
    if (e.target === _modal) {
      _modal.classList.remove('open');
      onClose();
    }
  });

  // Re-render discovery list when a new WiFi device appears
  setOnDeviceDiscovered(() => {
    if (_modal.classList.contains('open')) rebuildDiscoveryList();
  });

  // Re-render serial section when ports list changes
  setOnSerialPortsChanged(() => {
    if (_modal.classList.contains('open')) rebuildSerialList();
  });

  // Rebuild cards when a serial device's identity updates (SN/name from query response)
  setOnDeviceUpdated(() => {
    if (_modal.classList.contains('open')) rebuildDeviceCards();
  });

  // Data callback — handled by rAF readout
  setOnDataReceived(() => {});

  // ── Global tare shortcut (backtick key, MIDI, top-bar button) ──
  // Tare whichever device is assigned to cursor role.
  const tareCursorFn = () => {
    for (const dev of getDevices().values()) {
      if (dev.role === 'cursor' && dev.feeding) {
        captureTare(dev);
        // Update card tare UI if modal is open
        if (_modal.classList.contains('open')) {
          const card = document.querySelector(`.imu-setup-card[data-sn="${dev.sn}"]`);
          if (card) {
            const tareClear  = card.querySelector('.js-tare-clear');
            const tareStatus = card.querySelector('.js-tare-status');
            if (tareClear)  tareClear.disabled = false;
            if (tareStatus) { tareStatus.textContent = 'tare active'; tareStatus.classList.add('active'); }
          }
        }
        break;
      }
    }
  };
  S._tareCursor = tareCursorFn;
  document.getElementById('cursorZeroTopBtn')?.addEventListener('click', tareCursorFn);

  _initialized = true;
  DEBUG && console.log('[ui-imu-setup] initialized');
}

// ── Modal lifecycle ─────────────────────────────────────────────────────────

function onOpen() {
  rebuildDiscoveryList();
  rebuildSerialList();
  scanSerialPorts();  // async — will trigger rebuildSerialList via callback
  rebuildDeviceCards();
  startRAF();
}

function onClose() {
  stopRAF();
}

function startRAF() {
  if (_rafId) return;
  function tick() {
    updateAllReadouts();
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

function stopRAF() {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

// ── Discovery list ──────────────────────────────────────────────────────────

function rebuildDiscoveryList() {
  const container = document.getElementById('imuSetupDiscovery');
  if (!container) return;

  const discovered = getDiscovered();
  const devices    = getDevices();

  if (discovered.size === 0) {
    container.innerHTML = '<div class="imu-setup-empty">searching for x-IMU3 devices on the network…</div>';
    return;
  }

  container.innerHTML = '';
  for (const [sn, info] of discovered) {
    const isConnected = devices.has(sn);
    const row = document.createElement('div');
    row.className = 'imu-setup-device-row' + (isConnected ? ' connected' : '');

    const label = document.createElement('span');
    label.className = 'imu-setup-device-info';
    label.textContent = `${info.name}  ·  ${sn}  ·  ${info.ip}`;
    if (info.battery !== undefined) label.textContent += `  ·  ${info.battery}%`;

    const btn = document.createElement('button');
    btn.className = 'imu-setup-connect-btn';
    btn.textContent = isConnected ? 'disconnect' : 'connect';
    btn.addEventListener('click', async () => {
      if (isConnected) {
        await disconnectDevice(sn);
      } else {
        await connectDevice(sn);
      }
      rebuildDiscoveryList();
      rebuildDeviceCards();
    });

    row.appendChild(label);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

// ── Serial port list ────────────────────────────────────────────────────────

function rebuildSerialList() {
  const container = document.getElementById('imuSetupSerial');
  if (!container) return;

  const ports   = getSerialPorts();
  const devices = getDevices();

  // Check which serial paths are already connected
  const connectedPaths = new Set();
  for (const dev of devices.values()) {
    if (dev.transport === 'serial') connectedPaths.add(dev.serialPath);
  }

  if (ports.length === 0) {
    container.innerHTML = '<div class="imu-setup-empty">no serial ports found — click rescan or plug in USB</div>';
    return;
  }

  container.innerHTML = '';
  for (const p of ports) {
    const isConnected = connectedPaths.has(p.path);
    const row = document.createElement('div');
    row.className = 'imu-setup-device-row' + (isConnected ? ' connected' : '');

    const label = document.createElement('span');
    label.className = 'imu-setup-device-info';
    label.textContent = p.path;
    if (p.manufacturer) label.textContent += `  ·  ${p.manufacturer}`;

    const btn = document.createElement('button');
    btn.className = 'imu-setup-connect-btn';
    btn.textContent = isConnected ? 'disconnect' : 'connect';
    btn.addEventListener('click', async () => {
      if (isConnected) {
        // Find the device by serialPath
        for (const [sn, dev] of devices) {
          if (dev.serialPath === p.path) {
            await disconnectDevice(sn);
            break;
          }
        }
      } else {
        await connectSerialDevice(p.path);
      }
      rebuildSerialList();
      rebuildDeviceCards();
    });

    row.appendChild(label);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

// ── Per-device cards ────────────────────────────────────────────────────────

function rebuildDeviceCards() {
  const container = document.getElementById('imuSetupCards');
  if (!container) return;

  const devices = getDevices();

  if (devices.size === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';
  for (const [sn, dev] of devices) {
    container.appendChild(buildCard(dev));
  }
}

function buildCard(dev) {
  const card = document.createElement('div');
  card.className = 'imu-setup-card';
  card.dataset.sn = dev.sn;

  const isOSC    = dev.transport === 'osc';
  const isDirect = !isOSC;  // udp or serial — can send hardware commands

  card.innerHTML = `
    <div class="imu-setup-card-header">${dev.name}  ·  ${dev.sn}  <span class="imu-setup-transport-badge">${dev.transport}</span></div>

    ${isDirect ? `
    <!-- Axes alignment (hardware config — direct connection only) -->
    <div class="imu-setup-section">
      <div class="imu-setup-section-label">axes alignment</div>
      <div class="imu-setup-row">
        <span class="imu-setup-sublabel">NWU is fixed — which sensor axis points N, W, U?</span>
      </div>
      <div class="imu-setup-row">
        <select class="imu-setup-select js-alignment"></select>
      </div>
    </div>` : ''}

    <!-- Readout: NWU | axis mapping | raw | polarity | calibrated -->
    <div class="imu-setup-section">
      <div class="imu-setup-section-label">orientation <span class="js-msg-badge imu-setup-msg-badge">—</span></div>
      <table class="imu-setup-readout-table imu-setup-readout-rows">
        <tr>
          <th></th><th></th><th></th><th>raw</th><th></th><th>calibrated</th><th></th>
        </tr>
        <tr>
          <td class="imu-setup-euler-label">roll</td>
          <td class="imu-setup-axis-label">N</td>
          <td class="imu-setup-axis-map js-axis-n">+X</td>
          <td class="imu-setup-val js-raw-roll">—</td>
          <td><button class="imu-setup-pol-btn js-pol-roll">+</button></td>
          <td class="imu-setup-val js-cal-roll">—</td>
          <td><button class="imu-setup-mute-btn js-roll-mute">mute</button></td>
        </tr>
        <tr>
          <td class="imu-setup-euler-label">pitch</td>
          <td class="imu-setup-axis-label">W</td>
          <td class="imu-setup-axis-map js-axis-w">+Y</td>
          <td class="imu-setup-val js-raw-pitch">—</td>
          <td><button class="imu-setup-pol-btn js-pol-pitch">+</button></td>
          <td class="imu-setup-val js-cal-pitch">—</td>
        </tr>
        <tr>
          <td class="imu-setup-euler-label">yaw</td>
          <td class="imu-setup-axis-label">U</td>
          <td class="imu-setup-axis-map js-axis-u">+Z</td>
          <td class="imu-setup-val js-raw-yaw">—</td>
          <td><button class="imu-setup-pol-btn js-pol-yaw">+</button></td>
          <td class="imu-setup-val js-cal-yaw">—</td>
        </tr>
      </table>
    </div>

    <!-- Tare -->
    <div class="imu-setup-section">
      <div class="imu-setup-section-label">tare</div>
      <div class="imu-setup-row imu-setup-tare-row">
        <button class="imu-setup-tare-btn js-tare-capture">capture tare</button>
        <button class="imu-setup-tare-btn secondary js-tare-clear" disabled>clear tare</button>
        <span class="imu-setup-tare-status js-tare-status">no tare set</span>
      </div>
    </div>

    <!-- Role + Feed -->
    <div class="imu-setup-section imu-setup-feed-section">
      <div class="imu-setup-row imu-setup-role-row">
        <label class="imu-setup-sublabel">role</label>
        <select class="imu-setup-select imu-setup-role-select js-role">
          <option value="cursor">cursor</option>
          <option value="frame">frame</option>
        </select>
      </div>
      <button class="imu-setup-feed-btn js-feed">connect to sphere</button>
    </div>
  `;

  // ── Wire up alignment dropdown (direct connection only)
  const alignSel = card.querySelector('.js-alignment');
  if (alignSel) {
    for (const [value, label, desc] of AXES_ALIGNMENTS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value === 0 ? `${label} — default` : label;
      alignSel.appendChild(opt);
    }
    alignSel.value = dev.axesAlignment;
    alignSel.addEventListener('change', () => {
      setAxesAlignment(dev, parseInt(alignSel.value, 10));
      updateAxisMapLabels(card, dev.axesAlignment);
      // Tare was auto-cleared — update UI to reflect
      const tareClear  = card.querySelector('.js-tare-clear');
      const tareStatus = card.querySelector('.js-tare-status');
      if (tareClear)  tareClear.disabled = true;
      if (tareStatus) { tareStatus.textContent = 'no tare set'; tareStatus.classList.remove('active'); }
    });
  }

  // Set initial axis mapping labels from current alignment
  updateAxisMapLabels(card, dev.axesAlignment);

  // ── Polarity buttons
  for (const axis of ['roll', 'pitch', 'yaw']) {
    const btn = card.querySelector(`.js-pol-${axis}`);
    updatePolBtn(btn, dev.polarity[axis]);
    btn.addEventListener('click', () => {
      togglePolarity(dev, axis);
      updatePolBtn(btn, dev.polarity[axis]);
    });
  }

  // ── Roll mute button
  const rollMuteBtn = card.querySelector('.js-roll-mute');
  updateMuteBtn(rollMuteBtn, dev.rollMute);
  rollMuteBtn.addEventListener('click', () => {
    toggleRollMute(dev);
    updateMuteBtn(rollMuteBtn, dev.rollMute);
  });

  // ── Tare buttons
  const tareCapture = card.querySelector('.js-tare-capture');
  const tareClear   = card.querySelector('.js-tare-clear');
  const tareStatus  = card.querySelector('.js-tare-status');

  tareCapture.addEventListener('click', () => {
    captureTare(dev);
    tareClear.disabled = false;
    tareStatus.textContent = 'tare active';
    tareStatus.classList.add('active');
  });
  tareClear.addEventListener('click', () => {
    clearTare(dev);
    tareClear.disabled = true;
    tareStatus.textContent = 'no tare set';
    tareStatus.classList.remove('active');
  });
  // Reflect initial state
  if (dev.tareEuler) {
    tareClear.disabled = false;
    tareStatus.textContent = 'tare active';
    tareStatus.classList.add('active');
  }

  // ── Role dropdown
  const roleSel = card.querySelector('.js-role');
  roleSel.value = dev.role;
  roleSel.addEventListener('change', () => {
    setRole(dev, roleSel.value);
  });

  // ── Feed button (all transports — toggles mapping to sphere)
  const feedBtn = card.querySelector('.js-feed');
  if (feedBtn) {
    updateFeedBtn(feedBtn, dev.feeding);
    feedBtn.addEventListener('click', () => {
      const nowFeeding = !dev.feeding;
      setFeeding(dev, nowFeeding);
      updateFeedBtn(feedBtn, nowFeeding);
    });
  }

  return card;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Parse alignment label like '+X+Y+Z' into ['+X', '+Y', '+Z'] for N, W, U
function parseAlignmentAxes(alignValue) {
  const label = getAlignmentLabel(alignValue);  // e.g. '+X-Z+Y'
  // Each axis is a sign + letter, 2 chars each
  return [label.slice(0, 2), label.slice(2, 4), label.slice(4, 6)];
}

function updateAxisMapLabels(card, alignValue) {
  const [n, w, u] = parseAlignmentAxes(alignValue);
  const elN = card.querySelector('.js-axis-n');
  const elW = card.querySelector('.js-axis-w');
  const elU = card.querySelector('.js-axis-u');
  if (elN) elN.textContent = n;
  if (elW) elW.textContent = w;
  if (elU) elU.textContent = u;
}

function updatePolBtn(btn, sign) {
  btn.textContent = sign > 0 ? '+' : '−';
  btn.classList.toggle('reversed', sign < 0);
}

function updateMuteBtn(btn, muted) {
  btn.textContent = muted ? 'muted' : 'mute';
  btn.classList.toggle('active', muted);
}

function updateFeedBtn(btn, feeding) {
  btn.textContent = feeding ? 'disconnect from sphere' : 'connect to sphere';
  btn.classList.toggle('active', feeding);
}

function fmtDeg(val) {
  return typeof val === 'number' ? val.toFixed(1) + '°' : '—';
}

// ── rAF readout loop ────────────────────────────────────────────────────────

function updateAllReadouts() {
  const container = document.getElementById('imuSetupCards');
  if (!container) return;

  for (const card of container.children) {
    const sn = card.dataset.sn;
    const dev = getDevice(sn);
    if (!dev) continue;

    // Raw Euler
    card.querySelector('.js-raw-roll').textContent  = fmtDeg(dev.rawEuler.roll);
    card.querySelector('.js-raw-pitch').textContent = fmtDeg(dev.rawEuler.pitch);
    card.querySelector('.js-raw-yaw').textContent   = fmtDeg(dev.rawEuler.yaw);

    // Calibrated Euler (tare + polarity)
    const cal = dev.getCalibratedEuler();
    card.querySelector('.js-cal-roll').textContent  = fmtDeg(cal.roll);
    card.querySelector('.js-cal-pitch').textContent = fmtDeg(cal.pitch);
    card.querySelector('.js-cal-yaw').textContent   = fmtDeg(cal.yaw);

    // Message type badge
    const badge = card.querySelector('.js-msg-badge');
    if (badge) badge.textContent = dev.lastMsgType || '—';
  }
}
