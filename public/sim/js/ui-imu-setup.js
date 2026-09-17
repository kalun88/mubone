// ============================================================================
// ui-imu-setup.js — x-IMU3 mounting setup modal (per-device cards)
//
// Builds dynamic device cards for each connected x-IMU3.  Each card shows:
//   • axes alignment dropdown (hardware — sent to sensor)
//   • raw Euler readout, the axis map's flip buttons, calibrated output
//   • the two calibration gestures (mount, heading) and their clear
//   • role dropdown (cursor / camera / frame; gesture for the inertial stream)
//
// Discovery list at the top shows all visible devices with connect; a
// connected row that was connected from here carries Disconnect (2026-09-18).
// An OSC peer has neither — it registers itself from its first packet.
// ============================================================================

import { S, DEBUG } from './state.js';
import { sygOffers, sygConnectKnown, sygForgetKnown, sygConnectSerial, sygDisconnect } from './ui-sygaldry.js';
import {
  initIMUSetup,
  getDiscovered, getSerialPorts, getDevices, getDevice,
  connectDevice, connectSerialDevice, disconnectDevice, scanSerialPorts, requestSerialPort,
  setAxesAlignment, togglePolarity,
  captureMountPose1, captureMountPose2, cancelMountCapture, slotQuat,
  captureHeading, clearMountCal, hasMountCal, getPolarity, getCalibratedEuler,
  setRole,
  setOnDeviceDiscovered, setOnSerialPortsChanged, setOnDeviceUpdated,
  setOnDataReceived, setOnCommandResponse, setOnCommandSent,
  sendCommandTo, blinkDevice,
  AXES_ALIGNMENTS,
  getAlignmentLabel
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
  // The footer's zero button carries the same outcome as a colour flash —
  // its caption is 4 letters, so the message stays on the cabinet button.
  const fb = document.getElementById('tcZeroHeading');
  if (fb) {
    fb.classList.remove('flashing', 'sweep-flash');
    void fb.offsetWidth;                 // restart the animation on a re-hit
    fb.classList.add(cls);
    setTimeout(() => fb.classList.remove(cls), 900);
  }
  const btn = document.getElementById('cursorTareBtn');
  if (!btn) return;
  // Snapshot the REAL label once. Without this guard, hitting ` twice inside
  // the window would capture "✓ heading zeroed" as the label and restore that
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

// Is this page on screen? It has two hosts and only one of them is the modal:
// the settings shell (#255) MOVES this dialog into #settingsHost and takes the
// overlay's `.open` back off, so every `_modal.classList.contains('open')`
// guard read false while the page was in front of you — the list never
// repainted on discovery, and the selected sensor never rendered at all.
function _visible() {
  return !!_modal?.classList.contains('open')
      || !!document.querySelector('.settings-host .imu-setup-dialog');
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
  btn?.addEventListener('click', () => {
    _modal.classList.add('open');
    onOpen();
  });
  close?.addEventListener('click', () => {
    _modal.classList.remove('open');
    onClose();
  });

  // The list's own Rescan — the same sweep as the serial row's, from the place
  // you are looking when a sensor you expected is not in the list.
  // ── Rescan is the ONE attach verb (Ek, 2026-09-01: "just rescan is
  // enough"). Electron: enumerate ports; every row carries its own Connect,
  // the mubone tty's included. Browser: WebSerial lists nothing ungranted, so
  // Rescan IS the permission picker — one unfiltered request, routed by the
  // USB vendor after the pick: an RP2350 goes to the instrument link, anything
  // else joins the list as an x-imu3 candidate. (Post-pick routing is safe in
  // a browser because a PERSON picks; Electron never enters this branch, so
  // its auto-answering chooser — the reason S1 forbade one unfiltered picker —
  // is never handed an unfiltered request.)
  document.getElementById('imuSetupRescanAll')?.addEventListener('click', async () => {
    if (!window.electronBridge?.isElectron && navigator.serial) {
      const port = await requestSerialPort();
      if (port && isMuboneSerialPort({ vendorId: '0x' + (port.getInfo?.().usbVendorId ?? 0).toString(16) })) {
        await sygConnectSerial();
      } else if (port) {
        rebuildSerialList();
      }
      renderSensors();
      return;
    }
    scanSerialPorts();
    renderSensors();
  });

  // Command log: one row that opens in place (SETTINGS-GUI § 2 — a disclosure
  // is a row set revealed, not a second kind of chrome). The log element lives
  // in the static markup so its history survives a re-render of the sensor.
  const cmdRow = document.getElementById('imuSetupCmdRow');
  const cmdLog = document.getElementById('imuSetupCmdLog');
  if (cmdRow && cmdLog) {
    const toggle = () => {
      const open = cmdLog.hidden;
      cmdLog.hidden = !open;
      cmdRow.setAttribute('aria-expanded', String(open));
      cmdRow.classList.toggle('open', open);
      if (open) cmdLog.scrollTop = cmdLog.scrollHeight;
    };
    cmdRow.addEventListener('click', toggle);
    cmdRow.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
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
    if (_visible()) {
      rebuildDiscoveryList();
      updateTransportStatus();
    }
  });

  // Re-render serial section when ports list changes
  setOnSerialPortsChanged(() => {
    if (_visible()) {
      rebuildSerialList();
      updateTransportStatus();
    }
  });

  // Rebuild cards when a device's identity updates (SN/name from query, or OSC auto-discover)
  setOnDeviceUpdated(() => {
    if (_visible()) {
      rebuildDeviceCards();
      rebuildOSCList();
      updateTransportStatus();
    }
  });

  // OSC connection events — update status
  window.addEventListener('osc-connected', () => {
    _oscConnected = true;
    if (_visible()) {
      updateTransportStatus();
      rebuildOSCList();
    }
  });
  window.addEventListener('osc-disconnected', () => {
    _oscConnected = false;
    if (_visible()) {
      updateTransportStatus();
      rebuildOSCList();
    }
  });

  // Data callback — rAF readout handles display; also refresh OSC list on new device
  let _lastDeviceCount = 0;
  setOnDataReceived((dev) => {
    noteMessage(dev);
    const count = getDevices().size;
    if (count !== _lastDeviceCount) {
      _lastDeviceCount = count;
      if (_visible()) {
        renderSensors();
        renderSelected();
      }
    }
  });

  // Command log — show every command sent and response received
  setOnCommandSent((dev, jsonObj) => {
    _cmdSent++;
    if (_visible()) _syncCmdCount();
    _appendCmdLog('→', dev, jsonObj);
  });
  setOnCommandResponse((json) => {
    _appendCmdLog('←', null, json);
  });

  // ── Global HEADING-ZERO shortcut (backtick key, MIDI, top-bar button) ──
  // (helper above the handler so both the hit and miss paths can reach it)
  // Zero the heading of whichever device is assigned to cursor role.
  // Deliberately NOT the mount calibration: that is a setup act, and a key
  // you can hit mid-set must not be able to redefine the mounting.
  //
  // Tare is silent and instantaneous — nothing on screen moves unless the
  // sensor had already drifted, so without this the ` key is indistinguishable
  // from a key that isn't bound. Green + "✓ heading zeroed", orange + "no
  // cursor sensor" when there was nothing to tare: the same honest-signal rule
  // the LED dispatch below follows, since a silent no-op is exactly the case
  // you need to know about mid-set.
  const tareCursorFn = () => {
    let tared = false;
    for (const dev of getDevices().values()) {
      if (dev.role === 'cursor' && dev.feeding) {
        captureHeading(dev);
        // Dispatch from inside the loop, not from a wrapper: the top-bar button
        // binds this function directly, so a wrapper would only cover the
        // key/MIDI/OSC paths. Also means no LED when there's no cursor sensor
        // to tare, which is the honest signal.
        window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'tare' } }));
        // Update card tare UI if modal is open
        if (_visible()) {
          const card = document.querySelector(`.imu-setup-card[data-sn="${dev.sn}"]`);
          if (card) {
            const tareStatus = card.querySelector('.js-tare-status');
            if (tareStatus) tareStatus.textContent +=
              ` · heading zeroed ${new Date().toTimeString().slice(0, 5)}`;
          }
        }
        tared = true;
        break;
      }
    }
    // Steer and surface (Ek, 2026-09-03: "when I zero in sweep and surface
    // mode, it should also zero the cursor"): there the cursor is the camera's
    // forward, driven by the mouse, so zero puts the camera back to the front
    // of the sphere — the identity a mode change starts from (events.js) —
    // and drops any pending surface delta, or the next frame walks it off
    // again. The sensor tare above still runs if a cursor sensor is feeding,
    // so switching to sensor mode later is zeroed too. In sensor mode the
    // camera is derived from the cursor and the tare IS the zero.
    let camZeroed = false;
    if (S.cameraMode !== 'sensor') {
      S.camQ = [0, 0, 0, 1];
      if (S._surfaceDelta) { S._surfaceDelta.dx = 0; S._surfaceDelta.dy = 0; }
      camZeroed = true;
    }
    // Placed here rather than inside the loop so the miss case gets feedback
    // too — the button is bound to this function directly, so every entry
    // point (click, `, MIDI, OSC) lands on it.
    _flashTareBtn(camZeroed ? '✓ cursor zeroed' : tared ? '✓ heading zeroed' : 'no cursor sensor',
                  (camZeroed || tared) ? 'sweep-flash' : 'flashing');
  };
  S._tareCursor = tareCursorFn;
  document.getElementById('cursorTareBtn')?.addEventListener('click', tareCursorFn);

  _initialized = true;
  DEBUG && console.log('[ui-imu-setup] initialized');
}

// ── Modal lifecycle ─────────────────────────────────────────────────────────

function onOpen() {
  renderSensors();
  renderSelected();
  scanSerialPorts();  // async — the ports-changed callback re-renders the list
  _syncCmdCount();
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

// ── Selection ───────────────────────────────────────────────────────────────
// One sensor at a time is "the" sensor: its settings are the third part of the
// page, rendered once. N stacked cards was the two-column layout's idea, and it
// scaled by making the page longer rather than by making it clearer. Default is
// whichever sensor holds the cursor role — the one you are about to tare.
const _SEL_KEY = 'mubone_settings_sensor';
let _selectedSn = null;
try { _selectedSn = localStorage.getItem(_SEL_KEY); } catch (_) {}

function _resolveSelection() {
  const devices = getDevices();
  if (_selectedSn && devices.has(_selectedSn)) return _selectedSn;
  let want = null;
  for (const [sn, d] of devices) if (d.role === 'cursor') { want = sn; break; }
  if (!want) { const first = devices.keys().next(); want = first.done ? null : first.value; }
  _selectedSn = want;
  // Persist what was RESOLVED, not only what was clicked: otherwise the default
  // is recomputed every session and the stored key stays empty until someone
  // happens to pick a second sensor.
  if (want) { try { localStorage.setItem(_SEL_KEY, want); } catch (_) {} }
  return want;
}

function selectSensor(sn) {
  if (!getDevices().has(sn) || _selectedSn === sn) return;
  _selectedSn = sn;
  try { localStorage.setItem(_SEL_KEY, sn); } catch (_) {}
  renderSensors();
  renderSelected();
}

// ── Message rate ────────────────────────────────────────────────────────────
// The device object has no rate field, so it is counted here: two integer ops
// in the data callback (which runs at up to 400 Hz per device) and one divide a
// second in the rAF tick.
const _msgCount = new Map();   // sn → messages since the last sample
const _msgRate  = new Map();   // sn → msg/s
let   _rateAt   = 0;

// ORIENTATION only. A sensor that sends a quaternion and an inertial pair
// ticks the app twice per sample, so counting every message showed ~400/s
// beside a 199 Hz report rate and read as a contradiction (Ek asked). It also
// hid the useful number: the device produced 199.5/s and 162 arrived — the
// difference IS the wifi loss, and doubling both concealed it.
// 'Q' quaternion and 'A' Euler are orientation; 'I' inertial and 'S' accessory
// are other streams and belong to other readouts.
function noteMessage(dev) {
  if (dev.lastMsgType !== 'Q' && dev.lastMsgType !== 'A') return;
  _msgCount.set(dev.sn, (_msgCount.get(dev.sn) || 0) + 1);
}

// Returns true on the tick that actually sampled, which is the page's only
// 1 Hz edge — the sources badges are event-driven and a device falling silent
// is not an event, so greying it has to ride something. Reuse rather than a
// second timer: two clocks on one page drift apart and then disagree on screen.
function _sampleRates(now) {
  if (!_rateAt) { _rateAt = now; return false; }
  if (now - _rateAt < 1000) return false;
  const dt = (now - _rateAt) / 1000;
  _rateAt = now;
  for (const [sn, n] of _msgCount) { _msgRate.set(sn, Math.round(n / dt)); _msgCount.set(sn, 0); }
  return true;
}

// ── Guided mount calibration ────────────────────────────────────────────────
// A COUNTDOWN, not a stillness detector. The detector worked, but it gave the
// player nothing to act on: press Calibrate and either it silently advanced or
// it silently did not, with no way to tell which (Ek, 2026-08-31). A clock you
// can see is worth more than cleverness you cannot.
//
// Each pose is: N seconds to get into position, then N seconds holding while we
// sample. The hold window is AVERAGED rather than sampled once, so a hand that
// wobbles contributes its mean instead of whichever instant the timer landed on.

const CAL_READY_S  = 5;    // seconds to get into position
const CAL_HOLD_S   = 5;    // seconds held while sampling
const _CAL_TICK_MS = 100;

let _cal = null;

function _qAngle(a, b) {
  const d = Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]);
  return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
}

// Mean of a set of quaternions, sign-aligned to the first so q and -q (the same
// rotation) cannot cancel each other out.
function _qMean(list) {
  if (!list.length) return null;
  const [r] = list;
  const acc = [0, 0, 0, 0];
  for (const q of list) {
    const sgn = (q[0]*r[0] + q[1]*r[1] + q[2]*r[2] + q[3]*r[3]) < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) acc[i] += q[i] * sgn;
  }
  const n = Math.hypot(acc[0], acc[1], acc[2], acc[3]) || 1;
  return acc.map(v => v / n);
}

export function cancelMountRun() {
  if (!_cal) return;
  clearInterval(_cal.timer);
  cancelMountCapture(_cal.dev);
  const paint = _cal.onPaint;
  _cal = null;
  paint?.('idle', '');
}

// The four phases, in order. `hold` phases sample; `ready` phases only count.
const _CAL_STEPS = [
  { phase: 'ready1', secs: CAL_READY_S, hold: false,
    msg: (n) => `Get ready — hold it as it will be worn, aimed the way you play. Starting in ${n}…` },
  { phase: 'hold1',  secs: CAL_HOLD_S,  hold: true,
    msg: (n) => `HOLD — aimed forward · ${n}` },
  { phase: 'ready2', secs: CAL_READY_S, hold: false,
    msg: (n) => `Now BOW it forward — rotate it forwards, the way you would take a bow. ${n}…` },
  { phase: 'hold2',  secs: CAL_HOLD_S,  hold: true,
    msg: (n) => `HOLD — bowed forward · ${n}` },
];

export function startMountRun(dev, onPaint) {
  cancelMountRun();
  _cal = { dev, onPaint, step: 0, left: _CAL_STEPS[0].secs * 1000, samples: [],
           pose1: null, moved: 0, timer: null };
  onPaint('ready1', _CAL_STEPS[0].msg(_CAL_STEPS[0].secs));

  _cal.timer = setInterval(() => {
    const st = _CAL_STEPS[_cal.step];
    const q = slotQuat(dev);
    if (st.hold && q) _cal.samples.push(q);

    _cal.left -= _CAL_TICK_MS;
    if (_cal.left > 0) {
      onPaint(st.phase, st.msg(Math.ceil(_cal.left / 1000)));
      return;
    }

    // step complete
    if (st.hold) {
      const mean = _qMean(_cal.samples);
      if (!mean) { _finish(false, 'No sensor data arrived — is it still connected?'); return; }
      // how much the hand drifted during the hold, for honest feedback
      const spread = Math.max(0, ..._cal.samples.map(x => _qAngle(mean, x)));
      if (st.phase === 'hold1') {
        _cal.pose1 = mean; _cal.spread1 = spread;
        captureMountPose1(dev, mean);
      } else {
        const ok = captureMountPose2(dev, mean);
        const wobble = Math.max(_cal.spread1 || 0, spread);
        _finish(!!ok, ok
          ? (wobble > 8
              ? `Calibrated, but your hand moved ${wobble.toFixed(0)}° while holding — redo it if it feels off.`
              : 'Mount calibrated.')
          : 'Those two positions were too alike to tell apart — tip it further down and try again.');
        return;
      }
    }
    _cal.step++;
    _cal.samples = [];
    const next = _CAL_STEPS[_cal.step];
    _cal.left = next.secs * 1000;
    onPaint(next.phase, next.msg(next.secs));
  }, _CAL_TICK_MS);
}

function _finish(ok, msg) {
  const paint = _cal?.onPaint;
  if (_cal) { clearInterval(_cal.timer); if (!ok) cancelMountCapture(_cal.dev); }
  _cal = null;
  paint?.(ok ? 'done' : 'failed', msg);
}

// ── Part 1: sources ─────────────────────────────────────────────────────────
// Three rows, one per transport, each carrying a count. The dots-and-words bar
// this replaces said "wifi serial osc" in three states of the same grey and was
// the first thing on the page.

// (The page's own _isLive is gone, 2026-09-09: it read lastTimestamp, which
// for an x-imu3 is the device's µs-since-boot clock, and nothing called it.
// Liveness is imu-setup's `dev.live` now — one clock, one rule, every reader.)

function _badge(el, text, ok) {
  if (!el) return;
  el.textContent = text;
  el.className = 'set-badge' + (ok ? ' set-badge--ok' : '');
}

function renderSources() {
  // R1: the Sources table is gone. Its facts are ONE line under the list
  // count — "1 more found · wifi 2 · usb 1 · osc none" — and the full copy
  // survives as the empty state, the only moment it tells anyone anything.
  const line = document.getElementById('imuSetupSummary');
  if (!line) return;
  const devices    = getDevices();
  const discovered = getDiscovered();
  const byWord = { wifi: 0, usb: 0, osc: 0 };
  for (const d of devices.values()) {
    if (!d.live) continue;   // the head counts what is HERE, not what has been seen
    const wire = d.via === 'cable' ? 'usb' : (d.via || _TRANSPORT_WORD[d.transport] || d.transport);
    if (wire in byWord) byWord[wire]++;
  }
  let found = 0;
  for (const sn of discovered.keys()) if (!devices.has(sn)) found++;
  found += sygOffers().length;
  const parts = [];
  if (found) parts.push(`${found} more found`);
  for (const w of ['wifi', 'usb', 'osc']) parts.push(`${w} ${byWord[w] || 'none'}`);
  line.textContent = parts.join(' · ');
}

// Kept under its old name: the discovery / serial / OSC / device-update
// callbacks in initIMUSetupUI() all call it, and there is one list now.
function updateTransportStatus() { renderSources(); }

// ── Part 2: one sensor list ────────────────────────────────────────────────

// R2: a cable is USB to the person holding it; 'serial' is the API's word.
const _TRANSPORT_WORD = { udp: 'wifi', serial: 'usb', osc: 'osc' };

// The wire as a MARK, not a word (Ek, 2026-09-09: "make wifi and usb icons
// instead"). Two wires exist — see forgetOscSensor's commit: OSC is an address
// language, not a pathway — and each has a glyph everyone already reads. A
// sender with no declared wire keeps the word, because there is no honest
// picture of "unknown".
const _WIRE_GLYPH = {
  wifi: '<path d="M2.5 9.2a14 14 0 0 1 19 0"/><path d="M6 12.7a9 9 0 0 1 12 0"/><path d="M9.5 16.2a4.2 4.2 0 0 1 5 0"/><circle cx="12" cy="19.6" r="1.1" fill="currentColor" stroke="none"/>',
  usb:  '<path d="M12 4v13.5"/><circle cx="12" cy="19.3" r="1.8"/><path d="M12 13.5 7.5 10.5V8"/><circle cx="7.5" cy="6.4" r="1.5"/><path d="M12 15.5l4.5-3V9.8"/><rect x="15" y="6.4" width="3" height="3"/><path d="m10 6.5 2-2.5 2 2.5"/>'
};
const _wireMark = via => {
  const w = via === 'cable' || via === 'serial' ? 'usb' : (via === 'udp' ? 'wifi' : via);
  return _WIRE_GLYPH[w]
    ? `<svg class="set-wire" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><title>${w}</title>${_WIRE_GLYPH[w]}</svg>`
    : `<span>${w}</span>`;
};
const _fmtRate = r => r != null ? `${r} Hz` : '— Hz';

// The mubone instrument is an RP2350, so it carries Raspberry Pi's USB vendor.
// It shows up in this list because the list is every tty on the machine, and
// connecting it HERE does two bad things at once: the x-imu3 parser reads its
// binary OSC as garbage at about 1 Hz, and the port is exclusive, so the door
// that can actually read it is then locked out with "Failed to open serial
// port". Both were live bugs. The row stays visible and says where to go —
// a port that silently vanishes from a list is its own kind of confusion.
const MUBONE_USB_VENDOR = '2e8a';

// Electron's serialport gives '2e8a'; WebSerial gives '0x2e8a'. Normalise.
const _usbVendor = info => String(info?.vendorId || '').toLowerCase().replace(/^0x/, '');

function isMuboneSerialPort(info) {
  return _usbVendor(info) === MUBONE_USB_VENDOR;
}

// Only a port with a USB IDENTITY is a sensor candidate (Ek, 2026-09-09: the
// list showed "my bose headphones and bluetooth incoming port"). A sensor on a
// cable is a USB CDC device and always carries a vendor id; a Bluetooth serial
// profile or a system pseudo-port (tty.debug-console, tty.Bluetooth-Incoming-
// Port, every paired headset) has no USB descriptor and reports nothing. That
// is exactly what makes them noise, so it is exactly what the filter reads —
// no name matching, no list of things to hide. An unknown vendor still shows,
// labelled usb, so a new sensor is never invisible; the ruling above about a
// port that silently vanishes is about REAL devices, and this drops none.
//
// Known vendors get their proper name. The x-imu3's USB vendor is not recorded
// yet: plug one in over USB, read `window.electronBridge.serialListPorts()`,
// and add it here.
const _USB_VENDOR_NAME = { [MUBONE_USB_VENDOR]: 'mubone instrument' };
const _hasUsbIdentity = info => _usbVendor(info) !== '';

// Connected first, then anything visible but not connected.
// `cat` is the row's CATEGORY in this list — not to be confused with a
// DeviceState's `kind`, which is what the hardware is. A connected mubone
// instrument is cat 'connected', kind 'mubone'.
function _entries() {
  const devices    = getDevices();
  const discovered = getDiscovered();
  const out = [];
  for (const [sn, dev] of devices) out.push({ cat: 'connected', sn, dev });
  for (const [sn, info] of discovered) if (!devices.has(sn)) out.push({ cat: 'wifi', sn, info });
  // Known mubone instruments with a remembered wifi address, not currently
  // attached: seen = offerable = a row here, like every other sensor.
  for (const k of sygOffers()) out.push({ cat: 'syg', k });
  const usedPaths = new Set([...devices.values()]
    .filter(d => d.transport === 'serial').map(d => d.serialPath));
  for (const p of getSerialPorts())
    if (!usedPaths.has(p.path) && _hasUsbIdentity(p)) out.push({ cat: 'serial', path: p.path, info: p });
  return out;
}

// Why this list is empty, in the terms of the situation you are actually in.
// scripts/browser-audit.js reads this text: browser mode cannot open a UDP
// socket, and a page that just says "no sensors" makes that look like a fault.
function _emptyMessage() {
  // R1: the Sources table's full copy IS the empty state — the only moment
  // that prose tells anyone anything. scripts/browser-audit.js reads the
  // mode-specific last line: browser mode cannot open a UDP socket, and a
  // page that just says "no sensors" makes that look like a fault.
  const isElectron = !!window.electronBridge?.isElectron;
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const foot = isElectron
    ? 'Listening for x-imu3 broadcasts on UDP 10000. Plug a sensor in over USB, or power one on.'
    : isLocal
      ? 'A browser can\'t open UDP sockets, so Wi-Fi discovery goes through the local proxy — run <code>node proxy.js</code> and this list fills. Serial / USB needs nothing extra.'
      : 'Wi-Fi sensors need the desktop app or a local proxy, neither of which a hosted page can reach. Use serial / USB to connect an x-imu3 over WebSerial.';
  return `<div class="imu-empty-sources">
    <div class="imu-empty-row"><b class="imu-empty-key">Wi-Fi</b><span>x-imu3 units announcing themselves, and mubone instruments at remembered addresses.</span></div>
    <div class="imu-empty-row"><b class="imu-empty-key">Serial / USB</b><span>Wired sensors with a USB identity — Bluetooth and system ports are not listed. Ports are listed on demand, not polled.</span></div>
    <div class="imu-empty-row"><b class="imu-empty-key">OSC</b><span>Anything sending /sensor/{name}/quaternion on port 7500.</span></div>
  </div><p class="imu-empty-foot">${foot}</p>`;
}

function renderSensors() {
  renderSources();
  const list = document.getElementById('imuSetupRows');
  if (!list) return;

  const entries   = _entries();
  const connected = entries.filter(e => e.cat === 'connected' && e.dev.live).length;
  const count = document.getElementById('imuSetupListCount');
  if (count) count.textContent = `${connected} sensor${connected === 1 ? '' : 's'}`;

  if (!entries.length) {
    list.innerHTML = `<div class="set-empty imu-setup-empty">${_emptyMessage()}</div>`;
    return;
  }

  const sel = _resolveSelection();
  list.innerHTML = '';
  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'set-device';
    const isConnected = e.cat === 'connected';
    if (!isConnected) row.classList.add('set-device--idle');
    if (isConnected && e.sn === sel) row.classList.add('set-device--sel');

    // The sub-line is the wire's mark, then only what changes: the rate and
    // the role (Ek, 2026-09-09: "a bit too much info"). The kind and the
    // serial number move to the row's title — the name already says which
    // instrument this is, and "mubone" beside "amber-blenny" said it twice.
    // `meta` is HTML for the glyph; every text part goes through esc().
    const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let name, meta, title = '';
    if (isConnected) {
      const d = e.dev;
      const via = d.via || _TRANSPORT_WORD[d.transport] || d.transport;
      meta = _wireMark(via) + ' ' + [`<span class="js-row-rate">${_fmtRate(_msgRate.get(d.sn))}</span>`, esc(d.role)].join(' · ');
      name = d.name;
      title = d.sn.startsWith('osc-') ? d.kind : `${d.kind} ${d.sn}`;
      row.dataset.sn = d.sn;
    } else if (e.cat === 'wifi') {
      name = e.info.name || 'x-IMU3';
      meta = _wireMark('wifi') + ' ' + [esc(e.info.ip),
              e.info.battery != null ? `${esc(e.info.battery)}%` : null].filter(Boolean).join(' · ');
      title = `x-imu3 ${e.sn}`;
    } else if (e.cat === 'syg') {
      name = e.k.name;
      meta = _wireMark('wifi') + ' ' + esc(e.k.address);
      title = 'mubone instrument';
    } else {
      name = e.info.path;
      meta = _wireMark('usb') + ' ' + esc(_USB_VENDOR_NAME[_usbVendor(e.info)] || e.info.manufacturer || 'unknown vendor');
    }

    row.innerHTML =
      `<span class="set-device-n">${i + 1}</span>` +
      `<span class="set-device-mark${isConnected && e.dev.live ? ' set-device-ok' : ''}">${isConnected && e.dev.live ? '✓' : '•'}</span>` +
      `<span class="set-device-text"><span class="set-device-name"></span>` +
      `<span class="set-device-meta">${meta}</span></span>`;
    row.querySelector('.set-device-name').textContent = name;
    if (title) row.title = title;

    // Right edge: what this row can do next.
    if (isConnected) {
      // The fact first: every connected row says CONNECTED (Ek, 2026-09-09:
      // "it's more important to know that sensor connected"). Which one the
      // block below is showing is the ember edge, not a word — "Selected"
      // was naming the list's own mechanism where the rig's state belongs.
      // Blink identifies one among several; with one sensor it has nothing
      // to tell apart and takes no room.
      if (connected > 1) {
        const bl = document.createElement('button');
        bl.className = 'set-btn set-btn--sm js-blink';
        bl.textContent = 'Blink';
        bl.title = 'blink the LED on this device to identify it';
        bl.addEventListener('click', ev => { ev.stopPropagation(); blinkDevice(e.dev, 5, 200); });
        row.appendChild(bl);
      }
      // Connected while packets arrive; NO SIGNAL the moment they stop
      // (dev.live, imu-setup.js) — the kit's brick badge. The row stays,
      // because the sensor may come back and its block is still its block.
      const b = document.createElement('span');
      b.className = 'set-badge set-device-id ' + (e.dev.live ? 'set-badge--ok' : 'set-badge--err');
      b.textContent = e.dev.live ? 'Connected' : 'No signal';
      row.appendChild(b);
      // Disconnect sits with Connect: every row that was connected from this
      // list can be let go from it (Ek, 2026-09-18). An OSC peer was never
      // connected from here, so it has no such verb — it registers itself.
      const d = e.dev;
      if (d.transport === 'udp' || d.transport === 'serial' || d.kind === 'mubone') {
        const x = document.createElement('button');
        x.className = 'set-btn set-btn--sm';
        x.textContent = 'Disconnect';
        x.title = 'let this sensor go — its mounting and role are kept for the next connect';
        x.addEventListener('click', async ev => {
          ev.stopPropagation(); x.disabled = true;
          if (d.kind === 'mubone') await sygDisconnect(d.sn.replace(/^osc-/, ''));
          await disconnectDevice(d.sn);
          renderSensors(); renderSelected();
        });
        row.appendChild(x);
      }
      // The door to its settings, the rail's ⋯: the block below is this
      // row's drawer, and a drawer's handle sits on the row it opens. Lit
      // while the block is showing this sensor.
      const more = document.createElement('button');
      more.className = 'set-btn set-btn--sm set-device-more';
      more.setAttribute('aria-pressed', String(e.sn === sel));
      more.title = 'its settings — the block below';
      more.innerHTML = '<svg class="set-device-more-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>';
      more.addEventListener('click', ev => {
        ev.stopPropagation();
        selectSensor(e.sn);
        document.getElementById('imuSetupSelected')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      row.appendChild(more);
    } else if (e.cat === 'syg') {
      const f = document.createElement('button');
      f.className = 'set-btn set-btn--sm';
      f.textContent = '✕';
      f.title = `forget ${e.k.name}`;
      f.addEventListener('click', ev => { ev.stopPropagation(); sygForgetKnown(e.k.name); });
      row.appendChild(f);
      const b = document.createElement('button');
      b.className = 'set-btn set-btn--sm set-device-id imu-setup-connect-btn';
      b.textContent = 'Connect';
      b.title = `over wifi, at ${e.k.address}`;
      b.addEventListener('click', async ev => {
        ev.stopPropagation(); b.disabled = true;
        await sygConnectKnown(e.k);
        renderSensors(); renderSelected();
      });
      row.appendChild(b);
    } else if (e.cat === 'serial' && isMuboneSerialPort(e.info)) {
      // A real Connect, through the INSTRUMENT's door (#320): sygaldry's
      // filtered request auto-resolves to the first RP2350 port in Electron,
      // which is this one whenever a single instrument is plugged in. (Two
      // instruments on cables at once: it takes the first — unplug the one
      // you don't mean, which is still faster than any dialog.)
      const b = document.createElement('button');
      b.className = 'set-btn set-btn--sm set-device-id imu-setup-connect-btn';
      b.textContent = 'Connect';
      b.addEventListener('click', async ev => {
        ev.stopPropagation(); b.disabled = true;
        await sygConnectSerial();
        renderSensors(); renderSelected();
      });
      row.appendChild(b);
    } else {
      const b = document.createElement('button');
      b.className = 'set-btn set-btn--sm set-device-id imu-setup-connect-btn';
      b.textContent = 'Connect';
      b.addEventListener('click', async ev => {
        ev.stopPropagation();
        b.disabled = true;
        if (e.cat === 'wifi') await connectDevice(e.sn);
        else                   await connectSerialDevice(e.info.path);
        renderSensors();
        renderSelected();
      });
      row.appendChild(b);
    }

    // Clicking a connected row selects it — that is what the list is FOR now.
    if (isConnected) row.addEventListener('click', () => selectSensor(e.sn));
    list.appendChild(row);
  });
}

// The three list rebuilds are one render now; the names stay because the
// discovery / serial-ports / data callbacks are wired to them.
function rebuildDiscoveryList() { renderSensors(); }
function rebuildSerialList()    { renderSensors(); }
function rebuildOSCList()       { renderSensors(); }
function rebuildDeviceCards()   { renderSensors(); renderSelected(); }
S._refreshSensorList = renderSensors;

// ui-sygaldry.js calls this when its set of instruments changes: the card is
// what actually puts an instrument's block on screen, so it has to re-read.
S._refreshSensorCard = rebuildDeviceCards;

// ── Part 3: the selected sensor ─────────────────────────────────────────────

function renderSelected() {
  const sec  = document.getElementById('imuSetupSelected');
  const body = document.getElementById('imuSetupSelectedBody');
  if (!sec || !body) return;

  const sn  = _resolveSelection();
  const dev = sn ? getDevice(sn) : null;
  if (!dev) { body.innerHTML = ''; sec.hidden = true; return; }
  sec.hidden = false;

  const isOSC    = dev.transport === 'osc';
  const isDirect = !isOSC;               // udp or serial — can send hardware commands
  // Storage = the x-imu3's hardware settings, or a sygaldry instrument's own
  // block. A plain OSC sensor has neither, and gets no door saying otherwise.
  const hasStorage = isDirect || !!S._sygaldryBlockFor?.(dev);
  const word     = _TRANSPORT_WORD[dev.transport] || dev.transport;

  // `.imu-setup-card` + data-sn stay: the global tare shortcut looks the block
  // up by that selector to refresh the tare line after ` is pressed.
  body.innerHTML = `
    <div class="imu-setup-card" data-sn="${dev.sn}">
      <h3 class="set-sec-title set-card-head">
        <span class="js-sel-name"></span>
        <span class="set-badge js-sel-id"></span>
        <span class="set-badge js-msg-badge set-card-live" title="orientation updates arriving per second">— Hz</span>
      </h3>
      ${dev.transport === 'udp' ? `<p class="set-sec-lede js-wifi-info"></p>` : ''}

      <!-- (The card's lede — "What it drives, and where forward is." — went
           2026-09-09, Ek: "this is not needed". The rows say it.) -->

      <!-- Ek, 2026-09-01 (on the rig, overriding the brief's R4): the two
           layers come back, renamed — the split people actually think in.
           Everything scrolls; there are no disclosure doors on this page. -->
      <h3 class="set-sec-title set-layer-head">Software settings</h3>
      <div class="set-row">
        <div class="set-row-text">
          <span class="set-row-title">Role</span>
          <span class="set-row-desc">Cursor drives the grain cursor, camera aims the viewport, frame anchors the sphere to your body.</span>
        </div>
        <div class="set-ctl">
          <select class="imu-setup-select imu-setup-role-select js-role">
            <option value="cursor">cursor</option>
            <option value="camera">camera</option>
            <option value="frame">frame</option>
          </select>
        </div>
      </div>

      <div class="set-row">
        <div class="set-row-text">
          <span class="set-row-title">Mounting and heading</span>
          <span class="set-row-desc">Mounting once per strap: aim it as you play, then bow forwards. Heading before each set: face the audience. <span class="js-tare-status">Not calibrated</span></span>
        </div>
        <div class="set-ctl">
          <button class="set-btn set-btn--sm set-btn--primary js-tare-capture" title="Set once per mounting. Aim it as you play, then bow it forwards — the rotation is the measurement. Gravity alone gives only 'up', so bowing forwards is the only way mubone can learn which way is forward. Held in mubone; the sensor is not written to.">Set mounting</button>
          <button class="set-btn set-btn--sm js-heading-zero" title="Zero the heading about true vertical. Safe to press at any time — it cannot disturb the mounting calibration. Same operation as the \` key, which aims at whichever sensor holds the cursor role.">Zero heading</button>
          <button class="set-btn set-btn--sm js-tare-clear" disabled>Clear</button>
        </div>
      </div>

      <!-- Set once, so behind a chevron. Orientation is a sub-block, not a
           row: seven columns of numbers that have to line up down the page,
           which a right-aligned control group cannot do. -->
      <div class="set-row set-row--head">
        <div class="set-row-text">
          <span class="set-row-title">Axes</span>
          <span class="set-row-desc">Raw is what the sensor sends. Calibrated is after mounting, heading and the flips — what drives the cursor. Flip an axis that turns the wrong way. + − − is the default, not a flip: the sensor counts pitch and yaw about its Z-up, the sphere about Y-up, and those two signs are the difference; a button is marked only when it differs from that.</span>
        </div>
      </div>
      <!-- A small dial beside each number (Ek, 2026-09-09: "i should have a
           small GUI to see those numbers not just the numbers") — the needle
           is turned by updateAllReadouts, the number beside it stays. -->
      <div class="js-grp-axes">
      <div class="set-table set-table--orient">
        <div class="set-table-head">
          <span>Axis</span><span>Maps to</span><span>Raw</span>
          <span>Flip</span><span>Calibrated</span>
        </div>
        <div class="set-table-row">
          <span>Roll</span><span class="js-axis-n">+X</span>
          <span class="set-table-num">${_dial('raw', 'roll')}<span class="set-table-numval js-raw-roll">—</span></span>
          <span class="set-table-act"><button class="imu-setup-pol-btn js-pol-roll">+</button></span>
          <span class="set-table-num">${_dial('cal', 'roll')}<span class="set-table-numval js-cal-roll">—</span></span>
        </div>
        <div class="set-table-row">
          <span>Pitch</span><span class="js-axis-w">+Y</span>
          <span class="set-table-num">${_dial('raw', 'pitch')}<span class="set-table-numval js-raw-pitch">—</span></span>
          <span class="set-table-act"><button class="imu-setup-pol-btn js-pol-pitch">+</button></span>
          <span class="set-table-num">${_dial('cal', 'pitch')}<span class="set-table-numval js-cal-pitch">—</span></span>
        </div>
        <div class="set-table-row">
          <span>Yaw</span><span class="js-axis-u">+Z</span>
          <span class="set-table-num">${_dial('raw', 'yaw')}<span class="set-table-numval js-raw-yaw">—</span></span>
          <span class="set-table-act"><button class="imu-setup-pol-btn js-pol-yaw">+</button></span>
          <span class="set-table-num">${_dial('cal', 'yaw')}<span class="set-table-numval js-cal-yaw">—</span></span>
        </div>
      </div>

      </div>

      ${hasStorage ? `
      <h3 class="set-sec-title set-layer-head">Device settings</h3>
      <p class="set-sec-lede">Held on the instrument. Where it publishes a value the row shows it back; where it does not, the row says when it was last sent.</p>
      ${isDirect ? `
        <div class="set-row">
          <div class="set-row-text">
            <span class="set-row-title">Axes alignment</span>
            <span class="set-row-desc">NWU is fixed — this says which sensor axis points north, west and up. Changing it clears the tare. The x-imu3 has this setting in hardware; an instrument that reports a fused quaternion does not.</span>
          </div>
          <div class="set-ctl">
            <select class="imu-setup-select set-select--wide js-alignment"></select>
          </div>
        </div>` : ''}
      <!-- A first-party instrument's own rows arrive here; ui-sygaldry.js owns
           them and hands over the block it has already bound. -->
      <div class="js-syg-slot"></div>` : '<div class="js-syg-slot" hidden></div>'}

      <div class="set-row set-row--head">
        <div class="set-row-text">
          <span class="set-row-title">Command log</span>
          <span class="set-row-desc js-cmd-count">No commands sent this session.</span>
        </div>
      </div>
      <div class="js-cmd-log imu-cmd-log"></div>

    </div>`;

  const card = body.querySelector('.imu-setup-card');
  {
    // The command log is a session-scoped list both control paths append to.
    const log = (S._cmdLog || []);
    const n = card.querySelector('.js-cmd-count');
    if (n) n.textContent = log.length
      ? `${log.length} command${log.length === 1 ? '' : 's'} sent this session.`
      : 'No commands sent this session.';
    const host = card.querySelector('.js-cmd-log');
    if (host) host.textContent = log.slice(-60).map(e =>
      `${new Date(e.t).toTimeString().slice(0, 8)}  ${e.what}`).join('\n');
  }
  // The instrument's own rows. ui-sygaldry.js keeps the block — it is bound and
  // may hold a half-typed network name — so this borrows the element rather
  // than asking for new markup, the same way the settings shell borrows a
  // dialog. innerHTML above detached it; appending puts it back.
  const slot = card.querySelector('.js-syg-slot');
  if (slot) {
    const block = S._sygaldryBlockFor?.(dev);
    // (No heading over the block any more — "Device settings" above the slot
    // is clear enough, Ek 2026-09-01. The old 'On the instrument' head was
    // appended here, which is why deleting the template heads missed it.)
    if (block) slot.appendChild(block);
  }
  card.querySelector('.js-sel-name').textContent = dev.name;
  // Same rule as the device row: an 'osc-' id repeats the name beside it, and
  // `via` is the honest word for a cabled instrument that arrives as OSC.
  const selId = dev.sn.startsWith('osc-') ? dev.kind : `${dev.kind} ${dev.sn}`;
  // "osc · osc" is one fact said twice — a generic OSC sensor's kind IS its
  // transport. Say the word once; two words only when they differ.
  const link = dev.via || word;
  // The wire is the same MARK the list wears; a bare OSC sender keeps the word.
  const escId = String(selId).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  card.querySelector('.js-sel-id').innerHTML =
    selId === link ? escId : `${escId} ${_wireMark(link)}`;
  const wifiInfo = card.querySelector('.js-wifi-info');
  if (wifiInfo) wifiInfo.textContent = _wifiInfoText(dev);

  wireDisclosures(card);
  wireSelected(card, dev);
}

// Every handler the cards carried, unchanged in behaviour and still found by
// the same .js-* hooks — only the markup around them is different.
// Same shape as the command log's row (index.html), generalised: a row marked
// js-disclose shows and hides the block named in its data-for. The chevron
// turns via .open — settings-gui.css § the disclosure row.
function wireDisclosures(root) {
  for (const row of root.querySelectorAll('.js-disclose')) {
    const target = root.querySelector('.' + row.dataset.for);
    if (!target) continue;
    // Once only. A borrowed instrument block is wired when it is built AND
    // again by the card it is lent to; twice means every click toggles twice
    // and the group never opens, and a card re-render would add another pair.
    if (row.dataset.wired) continue;
    row.dataset.wired = '1';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-expanded', String(!target.hidden));
    const toggle = () => {
      const open = target.hidden;
      target.hidden = !open;
      row.setAttribute('aria-expanded', String(open));
      row.classList.toggle('open', open);
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }
}

// Lent to ui-sygaldry.js so an instrument block gets the same disclosure
// behaviour as the card it lands in, without that module importing this one.
S._wireDisclosures = wireDisclosures;

function wireSelected(card, dev) {
  // ── Alignment dropdown (direct connection only)
  const alignSel = card.querySelector('.js-alignment');
  if (alignSel) {
    for (const [value, label] of AXES_ALIGNMENTS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value === 0 ? `${label} — default` : label;
      alignSel.appendChild(opt);
    }
    alignSel.value = dev.axesAlignment;
    alignSel.addEventListener('change', () => {
      setAxesAlignment(dev, parseInt(alignSel.value, 10));
      updateAxisMapLabels(card, dev.axesAlignment);
      // Tare was auto-cleared — say so where the tare state lives.
      const tareClear  = card.querySelector('.js-tare-clear');
      const tareStatus = card.querySelector('.js-tare-status');
      if (tareClear)  tareClear.disabled = true;
      if (tareStatus) { tareStatus.textContent = 'No tare set'; tareStatus.classList.remove('active'); }
    });
  }
  updateAxisMapLabels(card, dev.axesAlignment);

  // ── Polarity buttons — these write the slot's axis map now, so they are
  // applied AFTER the mount and heading rotations and cannot invalidate them.
  for (const axis of ['roll', 'pitch', 'yaw']) {
    const btn = card.querySelector(`.js-pol-${axis}`);
    updatePolBtn(btn, getPolarity(dev, axis), axis);
    btn.addEventListener('click', () => {
      updatePolBtn(btn, togglePolarity(dev, axis), axis);
    });
  }

  // (The roll Mute button left the table 2026-09-01 with the footer's RO —
  // the camera takes no roll and the mapping page toggles rows itself, so a
  // third mute had no reader left. A stale mute:true in an old saved cal is
  // still honoured by findForwardAxis; nothing can set a new one.)

  // ── Tare + heading
  // ── Mount calibration + heading zero
  // Two gestures on purpose. Mount is SETUP — once per mounting, and it is the
  // one that makes a head, wrist or tuba mount behave like a hand. Heading is
  // PERFORMANCE — as often as you like, and it cannot move pitch or roll.
  const tareCapture = card.querySelector('.js-tare-capture');
  const tareClear   = card.querySelector('.js-tare-clear');
  const headingZero = card.querySelector('.js-heading-zero');
  const tareStatus  = card.querySelector('.js-tare-status');

  const paintCal = () => {
    const has = hasMountCal(dev);
    tareClear.disabled = !has;
    tareStatus.textContent = has ? 'Mounting set' : 'Not calibrated';
    tareStatus.classList.toggle('active', has);
  };

  tareCapture.addEventListener('click', () => {
    if (tareCapture.dataset.running === '1') { cancelMountRun(); return; }
    startMountRun(dev, (phase, msg) => {
      const live = phase.startsWith('ready') || phase.startsWith('hold');
      tareCapture.dataset.running = live ? '1' : '';
      tareCapture.textContent = live ? 'Cancel' : 'Calibrate';
      if (live || phase === 'failed') { tareStatus.textContent = msg;
                                        tareStatus.classList.toggle('active', live); }
      else paintCal();
    });
  });
  tareClear  .addEventListener('click', () => { cancelMountRun(); clearMountCal(dev); paintCal(); });
  headingZero?.addEventListener('click', () => {
    captureHeading(dev);
    const t = new Date().toTimeString().slice(0, 5);
    if (tareStatus) tareStatus.textContent =
      (hasMountCal(dev) ? 'Mounting set' : 'Not calibrated') + ` · heading zeroed ${t}`;
  });
  paintCal();

  // ── Role
  const roleSel = card.querySelector('.js-role');
  roleSel.value = dev.role;
  roleSel.addEventListener('change', () => {
    setRole(dev, roleSel.value);
    renderSensors();          // the row's sub-line carries the role
  });

  // ("Feeds the sphere" is gone — Ek, 2026-09-01: a selected role just works.
  // setRole() implies feeding; connect paths feed on arrival.)
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

// The convention defaults, mirroring defaultQuatAxisMap() in sensor-registry:
// pitch and yaw map through −1 for EVERY sensor — that is the device-euler →
// viz handedness conversion, not a user edit. The amber "changed" face marks
// only a sign that DIFFERS from this default: for months the buttons marked
// sign < 0 instead, so a untouched sensor showed pitch and yaw burning amber
// and read as manual flips left behind (Ek, 2026-09-01: "the polarity of the
// pitch and yaw keep persisting" — measured: his stored signs were
// byte-identical to a fresh slot's defaults; nothing had persisted).
const DEFAULT_VIZ_SIGN = { roll: 1, pitch: -1, yaw: -1 };
function updatePolBtn(btn, sign, axis) {
  btn.textContent = sign > 0 ? '+' : '−';
  btn.classList.toggle('reversed', sign !== DEFAULT_VIZ_SIGN[axis]);
}

// The feed control is a toggle (SETTINGS-GUI § 3), so its STATE is the switch
// and its badge says the state in words; the old button carried both in a label
// that had to be read to know which way it pointed.


function fmtDeg(val) {
  return typeof val === 'number' ? val.toFixed(1) + '°' : '—';
}

// A 22px dial: a ring and a needle. `kind` is raw or cal — the calibrated
// needle wears the accent, the raw one the text colour, so the two columns
// read as "what arrives" and "what the cursor gets" before the numbers do.
function _dial(kind, axis) {
  return `<svg class="set-dial set-dial--${kind}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="10"/><line class="set-dial-zero" x1="12" y1="1" x2="12" y2="4"/>` +
    `<line class="set-dial-needle${kind === 'cal' ? ' set-dial-needle--cal' : ''} js-dial-${kind}-${axis}" x1="12" y1="12" x2="12" y2="3.5"/></svg>`;
}
function _turnDial(card, kind, axis, deg) {
  const n = card.querySelector(`.js-dial-${kind}-${axis}`);
  if (!n) return;
  const t = typeof deg === 'number' ? `rotate(${deg.toFixed(1)} 12 12)` : '';
  if (n.getAttribute('transform') !== t) n.setAttribute('transform', t);
}

// ── rAF readout loop ────────────────────────────────────────────────────────

function updateAllReadouts() {
  // Before the early return below: the sources rows are at the top of the page
  // and exist whether or not a sensor is selected.
  if (_sampleRates(performance.now())) {
    renderSources();
    // The list's rate too: a row is built once and rebuilt on device events,
    // so its first paint — before the first one-second sample — read "— Hz"
    // until the next event, which could be never (Ek: "is the hz broken?").
    for (const row of document.querySelectorAll('#imuSetupRows .set-device[data-sn]')) {
      const el = row.querySelector('.js-row-rate');
      const want = _fmtRate(_msgRate.get(row.dataset.sn));
      if (el && el.textContent !== want) el.textContent = want;
    }
  }

  const container = document.getElementById('imuSetupSelectedBody');
  if (!container) return;

  for (const card of container.children) {
    const sn = card.dataset.sn;
    const dev = getDevice(sn);
    if (!dev) continue;

    // Raw Euler
    card.querySelector('.js-raw-roll').textContent  = fmtDeg(dev.rawEuler.roll);
    card.querySelector('.js-raw-pitch').textContent = fmtDeg(dev.rawEuler.pitch);
    card.querySelector('.js-raw-yaw').textContent   = fmtDeg(dev.rawEuler.yaw);
    _turnDial(card, 'raw', 'roll',  dev.rawEuler.roll);
    _turnDial(card, 'raw', 'pitch', dev.rawEuler.pitch);
    _turnDial(card, 'raw', 'yaw',   dev.rawEuler.yaw);

    // Calibrated euler — the slot's zeroEuler, i.e. post-cal post-axis-map.
    // This called dev.getCalibratedEuler(), a method that stopped existing in
    // the 2026-08-31 calibration rewrite — every repaint of a live card threw
    // and died here, which is why this column showed "—" forever and the rate
    // badge below never updated (#308).
    const cal = getCalibratedEuler(dev);
    card.querySelector('.js-cal-roll').textContent  = fmtDeg(cal?.roll);
    card.querySelector('.js-cal-pitch').textContent = fmtDeg(cal?.pitch);
    card.querySelector('.js-cal-yaw').textContent   = fmtDeg(cal?.yaw);
    _turnDial(card, 'cal', 'roll',  cal?.roll);
    _turnDial(card, 'cal', 'pitch', cal?.pitch);
    _turnDial(card, 'cal', 'yaw',   cal?.yaw);

    // Rate badge — what the heading says about this sensor is that it is alive.
    const badge = card.querySelector('.js-msg-badge');
    if (badge) {
      const r = _msgRate.get(sn);
      badge.textContent = r != null ? `${r} Hz` : '— Hz';
    }
  }
}

// ── Command log helper ─────────────────────────────────────────────────────

// Consecutive-repeat coalescing. `sig` identifies "same shape of command to the
// same device"; a repeat updates the existing row's count instead of appending.
let _cmdLogLast = null;   // { sig, count, el }

// Commands sent this session — the disclosure row's label, so the log says how
// much there is to read before you open it.
let _cmdSent = 0;
function _syncCmdCount() {
  const el = document.getElementById('imuSetupCmdCount');
  if (el) el.textContent = `${_cmdSent} command${_cmdSent === 1 ? '' : 's'} sent this session`;
}

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
  if (!_visible()) { _cmdLogLast = null; return; }

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
