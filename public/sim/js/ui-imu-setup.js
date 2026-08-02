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
  scanSerialPorts, requestSerialPort,
  setAxesAlignment, togglePolarity, toggleRollMute,
  captureTare, clearTare, resetHeading,
  requestEulerMode, requestQuatMode,
  setFeeding, setRole,
  setOnDeviceDiscovered, setOnSerialPortsChanged, setOnDeviceUpdated,
  setOnDataReceived, setOnCommandResponse, setOnCommandSent,
  sendCommandTo, blinkDevice,
  AXES_ALIGNMENTS,
  getAlignmentLabel,
} from './imu-setup.js';

let _modal        = null;
let _rafId        = null;
let _initialized  = false;
let _oscConnected = false;

const _WIFI_REGIONS = { 1: 'US', 2: 'EU', 3: 'JP' };

// ── Tare-button flash ───────────────────────────────────────────────────────
// Swaps the session button's label for a short confirmation, matching the
// pattern sweep/erase already use. Local rather than imported: ui-sweep.js's
// version is private to that module, and this is six lines.
let _tareFlashTimer = null;
let _tareFlashHtml  = null;

function _flashTareBtn(msg, cls) {
  const btn = document.getElementById('cursorTareBtn');
  if (!btn) return;
  // Snapshot the REAL label once. Without this guard, hitting ` twice inside
  // the window would capture "✓ tared" as the label and restore that
  // permanently — the button would keep its confirmation forever.
  if (_tareFlashHtml === null) _tareFlashHtml = btn.innerHTML;
  clearTimeout(_tareFlashTimer);
  btn.classList.remove('flashing', 'sweep-flash');
  btn.textContent = msg;
  btn.classList.add(cls);
  _tareFlashTimer = setTimeout(() => {
    btn.innerHTML = _tareFlashHtml;
    btn.classList.remove('flashing', 'sweep-flash');
    _tareFlashHtml  = null;
    _tareFlashTimer = null;
  }, 900);
}

function _wifiInfoText(dev) {
  // The x-IMU3 has no wi_fi_mode setting — but the manual says RSSI is -1 in AP
  // mode and a valid percentage (0–100) in client mode. RSSI comes in via the
  // discovery broadcast, so it's populated immediately on first sight of the
  // device, before any settings queries complete.
  const rssi = dev.rssi;
  const isClient = (rssi != null && rssi >= 0);
  const isAp     = (rssi === -1);

  // Nothing queried yet and no RSSI — show placeholder
  const noAp     = dev.wifiApChannel == null && dev.wifiApSsid == null;
  const noClient = dev.wifiClientChannel == null && dev.wifiClientSsid == null;
  if (noAp && noClient && rssi == null) return 'querying wifi…';

  const ssid    = isClient ? dev.wifiClientSsid    : dev.wifiApSsid;
  const channel = isClient ? dev.wifiClientChannel : dev.wifiApChannel;
  const modeLabel = isClient ? 'client' : (isAp ? 'AP' : 'wifi');

  const parts = [modeLabel];
  if (ssid) parts.push(`SSID: ${ssid}`);
  // Client channel 0 means "All"/scan — device picks based on SSID. Skip channel label.
  if (channel) {
    const band = channel >= 36 ? '5 GHz' : '2.4 GHz';
    parts.push(`ch ${channel} (${band})`);
  }
  if (isClient && rssi != null) parts.push(`RSSI ${rssi}%`);
  if (dev.wifiRegion) parts.push(_WIFI_REGIONS[dev.wifiRegion] || `region ${dev.wifiRegion}`);
  return parts.join('  ·  ');
}

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
  if (!window.electronBridge?.isElectron && navigator.serial) {
    // Browser mode — "rescan" is useless (getPorts only returns already-granted ports).
    // Repurpose the rescan button as "add USB device" which prompts the user to pick a port.
    if (rescan) {
      rescan.textContent = 'add USB device';
      rescan.addEventListener('click', async () => {
        const port = await requestSerialPort();
        if (port) {
          rebuildSerialList();
        }
      });
    }
    // Hide the separate request button — rescan IS the request button now
    const reqBtn = document.getElementById('imuSetupSerialRequest');
    if (reqBtn) reqBtn.style.display = 'none';
  } else {
    // Electron mode — rescan enumerates all ports via Node serialport
    rescan?.addEventListener('click', () => {
      scanSerialPorts();
    });
  }
  _modal.addEventListener('click', e => {
    if (e.target === _modal) {
      _modal.classList.remove('open');
      onClose();
    }
  });

  // Re-render discovery list when a new WiFi AP device appears
  setOnDeviceDiscovered(() => {
    if (_modal.classList.contains('open')) {
      rebuildDiscoveryList();
      updateTransportStatus();
    }
  });

  // Re-render serial section when ports list changes
  setOnSerialPortsChanged(() => {
    if (_modal.classList.contains('open')) {
      rebuildSerialList();
      updateTransportStatus();
    }
  });

  // Rebuild cards when a device's identity updates (SN/name from query, or OSC auto-discover)
  setOnDeviceUpdated(() => {
    if (_modal.classList.contains('open')) {
      rebuildDeviceCards();
      rebuildOSCList();
      updateTransportStatus();
    }
  });

  // OSC connection events — update status
  window.addEventListener('osc-connected', () => {
    _oscConnected = true;
    if (_modal.classList.contains('open')) {
      updateTransportStatus();
      rebuildOSCList();
    }
  });
  window.addEventListener('osc-disconnected', () => {
    _oscConnected = false;
    if (_modal.classList.contains('open')) {
      updateTransportStatus();
      rebuildOSCList();
    }
  });

  // Data callback — rAF readout handles display; also refresh OSC list on new device
  let _lastDeviceCount = 0;
  setOnDataReceived(() => {
    const count = getDevices().size;
    if (count !== _lastDeviceCount) {
      _lastDeviceCount = count;
      if (_modal.classList.contains('open')) {
        rebuildOSCList();
        updateTransportStatus();
      }
    }
  });

  // Command log — show every command sent and response received
  setOnCommandSent((dev, jsonObj) => {
    _appendCmdLog('→', dev, jsonObj);
  });
  setOnCommandResponse((json) => {
    _appendCmdLog('←', null, json);
  });

  // ── Global tare shortcut (backtick key, MIDI, top-bar button) ──
  // (helper above the handler so both the hit and miss paths can reach it)
  // Tare whichever device is assigned to cursor role.
  //
  // Tare is silent and instantaneous — nothing on screen moves unless the
  // sensor had already drifted, so without this the ` key is indistinguishable
  // from a key that isn't bound. Green + "✓ tared" on success, orange + "no
  // cursor sensor" when there was nothing to tare: the same honest-signal rule
  // the LED dispatch below follows, since a silent no-op is exactly the case
  // you need to know about mid-set.
  const tareCursorFn = () => {
    let tared = false;
    for (const dev of getDevices().values()) {
      if (dev.role === 'cursor' && dev.feeding) {
        captureTare(dev);
        // Dispatch from inside the loop, not from a wrapper: the top-bar button
        // binds this function directly, so a wrapper would only cover the
        // key/MIDI/OSC paths. Also means no LED when there's no cursor sensor
        // to tare, which is the honest signal.
        window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'tare' } }));
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
        tared = true;
        break;
      }
    }
    // Placed here rather than inside the loop so the miss case gets feedback
    // too — the button is bound to this function directly, so every entry
    // point (click, `, MIDI, OSC) lands on it.
    _flashTareBtn(tared ? '✓ tared' : 'no cursor sensor',
                  tared ? 'sweep-flash' : 'flashing');
  };
  S._tareCursor = tareCursorFn;
  document.getElementById('cursorTareBtn')?.addEventListener('click', tareCursorFn);

  _initialized = true;
  DEBUG && console.log('[ui-imu-setup] initialized');
}

// ── Modal lifecycle ─────────────────────────────────────────────────────────

function onOpen() {
  updateTransportStatus();
  rebuildDiscoveryList();
  rebuildSerialList();
  rebuildOSCList();
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
    const isElectron = !!window.electronBridge?.isElectron;
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    let msg;
    if (isElectron) {
      msg = 'listening for x-IMU3 UDP broadcasts on port 10000…';
    } else if (isLocal) {
      // Browser WiFi is NOT desktop-only: imu-setup.js `_initBrowserTransport`
      // opens a control channel to proxy.js on ws://localhost:8081, which does
      // the UDP discovery and relays connect/disconnect/command. The only
      // requirement is that the proxy is running.
      msg = 'no sensors found — a browser can\'t open UDP sockets directly, so WiFi discovery goes through the local proxy. Run <code>node proxy.js</code> and this list will populate. Or use <em>serial / USB</em>, which needs nothing extra.';
    } else {
      // Remote origin (mubone.org/sim): the proxy would have to run on the
      // visitor's own machine and be reachable from this page — not the case
      // for a hosted demo. USB is the realistic path here.
      msg = 'WiFi sensors need the desktop app or a local proxy — neither is reachable from a hosted page. Use <em>serial / USB</em> to connect an x-imu3 over WebSerial.';
    }
    container.innerHTML = `<div class="imu-setup-empty">${msg}</div>`;
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
    if (info.rssi !== undefined && info.rssi >= 0) label.textContent += `  ·  ${info.rssi}% rssi`;

    // RSSI bar (visual indicator)
    if (info.rssi !== undefined && info.rssi >= 0) {
      const rssiBar = document.createElement('div');
      rssiBar.className = 'imu-setup-rssi-bar';
      rssiBar.style.width = `${info.rssi}%`;
      // Color code: green > 60%, yellow 30-60%, red < 30%
      rssiBar.style.background = info.rssi > 60 ? '#4a4' : info.rssi > 30 ? '#aa4' : '#a44';
      row.appendChild(rssiBar);
    }

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
    const isElectron = !!window.electronBridge?.isElectron;
    const hasWebSerial = !!navigator.serial;
    let msg;
    if (isElectron) {
      msg = 'no serial ports found — click rescan or plug in USB';
    } else if (hasWebSerial) {
      msg = 'click "add USB device" to connect a sensor via USB';
    } else {
      msg = 'WebSerial not available — use Chrome, or connect via Electron';
    }
    container.innerHTML = `<div class="imu-setup-empty">${msg}</div>`;
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

// ── Transport status ────────────────────────────────────────────────────────

function updateTransportStatus() {
  const devices   = getDevices();
  const discovered = getDiscovered();
  const isElectron = !!window.electronBridge?.isElectron;

  // WiFi AP/UDP: active if any UDP device connected, partial if devices discovered but not connected
  const udpEl = document.getElementById('imuTransportUDP');
  if (udpEl) {
    const hasUdpDevice = [...devices.values()].some(d => d.transport === 'udp');
    const hasDiscovery = discovered.size > 0;
    udpEl.classList.toggle('active', hasUdpDevice);
    udpEl.classList.toggle('partial', !hasUdpDevice && hasDiscovery);
  }
  // WiFi status hint
  const wifiStatus = document.getElementById('imuWifiStatus');
  if (wifiStatus) {
    const udpCount = [...devices.values()].filter(d => d.transport === 'udp').length;
    if (udpCount > 0) {
      wifiStatus.textContent = `${udpCount} connected`;
    } else if (discovered.size > 0) {
      wifiStatus.textContent = `${discovered.size} found`;
    } else if (isElectron) {
      wifiStatus.textContent = 'listening';
    } else {
      wifiStatus.textContent = '';
    }
  }

  // Serial: active if any serial device connected, partial if WebSerial available
  const serialEl = document.getElementById('imuTransportSerial');
  if (serialEl) {
    const hasSerialDevice = [...devices.values()].some(d => d.transport === 'serial');
    const hasSerial = isElectron || !!navigator.serial;
    serialEl.classList.toggle('active', hasSerialDevice);
    serialEl.classList.toggle('partial', !hasSerialDevice && hasSerial);
  }

  // OSC: active if any OSC device connected, partial if bridge/proxy connected
  const oscEl = document.getElementById('imuTransportOSC');
  if (oscEl) {
    const hasOscDevice = [...devices.values()].some(d => d.transport === 'osc');
    oscEl.classList.toggle('active', hasOscDevice);
    oscEl.classList.toggle('partial', !hasOscDevice && _oscConnected);
  }
  // OSC status hint
  const oscStatus = document.getElementById('imuOSCStatus');
  if (oscStatus) {
    const oscCount = [...devices.values()].filter(d => d.transport === 'osc').length;
    if (oscCount > 0) {
      oscStatus.textContent = `${oscCount} streaming`;
    } else if (_oscConnected) {
      oscStatus.textContent = isElectron ? 'bridge active' : 'connected';
    } else {
      oscStatus.textContent = '';
    }
  }
}

// ── OSC device list ────────────────────────────────────────────────────────

function rebuildOSCList() {
  const container = document.getElementById('imuSetupOSC');
  if (!container) return;

  const devices = getDevices();
  const oscDevices = [...devices.values()].filter(d => d.transport === 'osc');

  if (oscDevices.length === 0) {
    const isElectron = !!window.electronBridge?.isElectron;
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    let msg;
    if (_oscConnected) {
      msg = 'bridge connected — waiting for sensor data on /sensor/{name}/quaternion';
    } else if (isElectron) {
      msg = 'no OSC bridge — start Max or proxy on ws://localhost:8080';
    } else if (isLocal) {
      msg = 'no OSC sensors — connect via Max bridge or <code>node proxy.js</code>';
    } else {
      msg = 'OSC requires local setup — use USB serial, or run locally';
    }
    container.innerHTML = `<div class="imu-setup-empty">${msg}</div>`;
    return;
  }

  container.innerHTML = '';
  for (const dev of oscDevices) {
    const row = document.createElement('div');
    row.className = 'imu-setup-device-row connected';

    const label = document.createElement('span');
    label.className = 'imu-setup-device-info';
    label.textContent = `${dev.name}  ·  ${dev.slotName}  ·  role: ${dev.role}`;
    if (dev.feeding) label.textContent += '  ·  feeding';

    row.appendChild(label);
    container.appendChild(row);
  }
}

// ── Per-device cards ────────────────────────────────────────────────────────

function rebuildDeviceCards() {
  const container = document.getElementById('imuSetupCards');
  if (!container) return;

  const devices = getDevices();

  if (devices.size === 0) {
    container.innerHTML = '<div class="imu-setup-empty">no devices connected — connect a sensor from the list</div>';
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
    <div class="imu-setup-card-header">${dev.name}  ·  ${dev.sn}  <span class="imu-setup-transport-badge">${dev.transport === 'udp' ? 'wifi' : dev.transport}</span> <button class="imu-setup-blink-btn js-blink" title="blink LED on this device to identify it">blink</button></div>
    ${dev.transport === 'udp' ? `<div class="imu-setup-wifi-info js-wifi-info">${_wifiInfoText(dev)}</div>` : ''}

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
      <div class="imu-setup-section-label">tare <span class="imu-setup-hint-inline" title="Software tare zeros pitch + yaw in the calibrated output (instant, no hardware change). Zero heading resets the AHRS yaw reference on the hardware — the sensor must be pointing at your desired 0° when you press it.">?</span></div>
      <div class="imu-setup-row imu-setup-tare-row">
        <button class="imu-setup-tare-btn js-tare-capture" title="Store this sensor's current orientation as its zero reference — software only, does not touch the hardware heading. Same operation as 'tare cursor' (\`) in the session panel, which aims at whichever sensor holds the cursor role.">tare sensor</button>
        <button class="imu-setup-tare-btn secondary js-tare-clear" disabled>clear tare</button>
        <button class="imu-setup-tare-btn secondary js-heading-zero" title="Reset AHRS yaw reference to 0° on the hardware — sensor must be pointing at desired forward direction">zero heading</button>
        <span class="imu-setup-tare-status js-tare-status">no tare set</span>
      </div>
    </div>

    <!-- Role + Feed -->
    <div class="imu-setup-section imu-setup-feed-section">
      <div class="imu-setup-row imu-setup-role-row">
        <label class="imu-setup-sublabel">role</label>
        <select class="imu-setup-select imu-setup-role-select js-role"
                title="cursor = drives the granular cursor. camera = projector-aim: rotating the sensor pans the viewport. frame = body-reference: the sphere is attached to this sensor, cursor moves relative to it.">
          <option value="cursor">cursor</option>
          <option value="camera">camera</option>
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

  // ── Tare + heading buttons
  const tareCapture  = card.querySelector('.js-tare-capture');
  const tareClear    = card.querySelector('.js-tare-clear');
  const headingZero  = card.querySelector('.js-heading-zero');
  const tareStatus   = card.querySelector('.js-tare-status');

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
  headingZero.addEventListener('click', () => {
    resetHeading(dev);
    // resetHeading clears tare since the reference frame changed
    tareClear.disabled = true;
    tareStatus.textContent = 'heading zeroed';
    tareStatus.classList.remove('active');
  });
  // Hide zero heading for OSC devices (no hardware command path)
  if (dev.transport === 'osc') headingZero.style.display = 'none';
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

  // ── Blink button — send LED blinks to identify physical device
  const blinkBtn = card.querySelector('.js-blink');
  if (blinkBtn) {
    blinkBtn.addEventListener('click', () => {
      blinkDevice(dev, 5, 200);
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

// ── Command log helper ─────────────────────────────────────────────────────

// Consecutive-repeat coalescing. `sig` identifies "same shape of command to the
// same device"; a repeat updates the existing row's count instead of appending.
let _cmdLogLast = null;   // { sig, count, el }

// ── Command log ─────────────────────────────────────────────────────────────
// Two things make this handler worth guarding rather than leaving naive:
//
//   1. It runs on EVERY command. That was harmless when commands were a dozen
//      settings writes at connect time, but the x-IMU3 LED sends a colour
//      command continuously — up to 10/s while the timbre readout tracks the
//      cursor. Without the visibility gate, a closed modal still paid for
//      string building, createElement and an innerHTML parse ten times a
//      second, on the same main thread as the grain scheduler.
//   2. `scrollTop = scrollHeight` immediately after `appendChild` forces a
//      synchronous layout flush. Reading the scroll position *before* the
//      mutation instead keeps the read and the write on opposite sides of it,
//      which is the difference between one layout pass and two.
//
// Coalescing then stops colour traffic from evicting the interesting entries:
// at 10/s an 80-row buffer holds 8 seconds of history, so the connect handshake
// you actually wanted to read would scroll away before you could open the modal.
function _appendCmdLog(dir, dev, jsonObj) {
  // Nothing is visible — don't build DOM for a hidden element.
  if (!_modal?.classList.contains('open')) { _cmdLogLast = null; return; }

  const log = document.getElementById('imuSetupCmdLog');
  if (!log) return;

  const keys = Object.keys(jsonObj);
  // Show all key:value pairs in the object
  const parts = keys.map(k => {
    const v = jsonObj[k];
    return `<span class="cmd-key">${k}</span>${v === null ? '' : ': ' + v}`;
  }).join('  ');

  const who = dev ? `  <span style="color:#555">${dev.name || dev.sn} · ${dev.transport}</span>` : '';
  const dirClass = dir === '←' ? 'cmd-resp' : 'cmd-dir';
  const html = `<span class="${dirClass}">${dir}</span> ${parts}${who}`;

  // Same command shape to the same device, back to back — fold into the last
  // row. Keeps the newest value visible (colour changes as you move) while
  // costing one innerHTML write and no layout.
  const sig = `${dir}|${keys.join(',')}|${dev?.sn ?? ''}`;
  if (_cmdLogLast && _cmdLogLast.sig === sig && _cmdLogLast.el.isConnected) {
    _cmdLogLast.count++;
    _cmdLogLast.el.innerHTML = `${html} <span class="cmd-count">×${_cmdLogLast.count}</span>`;
    return;
  }

  // Read scroll state before mutating, so the autoscroll write doesn't force a
  // second layout — and so it doesn't fight a user who has scrolled up to read.
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;

  const entry = document.createElement('div');
  entry.className = 'imu-setup-cmd-log-entry';
  entry.innerHTML = html;
  log.appendChild(entry);
  _cmdLogLast = { sig, count: 1, el: entry };

  while (log.children.length > 80) log.removeChild(log.firstChild);
  if (atBottom) log.scrollTop = log.scrollHeight;
}
