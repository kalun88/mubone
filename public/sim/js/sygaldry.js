// ============================================================================
// sygaldry.js — talk to a first-party mubone instrument
//
// One OSC decoder, two transports. SLIP over Web Serial when the instrument is
// on the end of a cable; a WebSocket when it is on the network. They differ
// only in framing, which is why they share everything else.
//
// Decoded messages are translated into the app's existing sensor intake
// (/sensor/{name}/quaternion and /inertial) and handed to handleOSC, so nothing
// downstream needs to know which transport — or which kind of hardware — it is
// listening to.
// ============================================================================

import { handleOSC } from './osc.js';
import { S } from './state.js';
import { declareSensorKind } from './imu-setup.js';
import { encodeOSC, decodePacket, slipEncode, SlipDecoder } from './sygaldry-osc.js';

// ── What the browser can and cannot do ───────────────────────────────────────

export function capabilities() {
  const ua = navigator.userAgent;
  const chromium = !!window.chrome && /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua);
  // Chrome on iOS is a WKWebView skin: Safari underneath, so neither Web Serial
  // nor Chromium's local-network allowance is present however it identifies.
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    serial: !!navigator.serial,
    chromium: chromium && !iOS,
    secureContext: window.isSecureContext,
    // ws:// to a LAN address from an https page is a Chromium carve-out; Firefox
    // and WebKit both refuse it. Measured, not assumed.
    localWebSocket: chromium && !iOS,
  };
}

export function unsupportedReason() {
  const can = capabilities();
  if (can.serial && can.localWebSocket) return null;
  if (!can.chromium) {
    return 'mubone needs a Chrome-based browser (Chrome, Edge, Brave or Chromium) '
         + 'to reach the instrument. Other browsers block the connection.';
  }
  if (!can.serial) {
    return 'This browser has no Web Serial support, so it cannot talk to an instrument over USB.';
  }
  return null;
}

// ── Address translation ──────────────────────────────────────────────────────
//
// The instrument publishes its own component tree; the app speaks
// /sensor/{name}/…. This is the only place the two vocabularies meet.

const SYGALDRY_TO_APP = {
  '/BNO085/orientation': 'quaternion',   // [x, y, z, w] — the app's order
  '/BNO085/angular_rate': 'gyro',
  '/BNO085/acceleration': 'accel',
};

// ── Coming back on our own ───────────────────────────────────────────────────
//
// A wireless link that drops is not an event anyone should have to notice, let
// alone answer with a button. The delays mirror sygbr-wifi's station retry --
// five seconds, doubling to thirty, reset on success -- so both ends of the
// connection tell the same story about how long to wait before trying again.
//
// Only the network reconnects itself. A cable that stopped answering was almost
// always unplugged by a person, and dialling it again would fight them.

const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 30000;

// Every refresh we send is answered, so silence lasting several of them is not a
// quiet instrument; it is a connection that is no longer there. TCP works that
// out on its own eventually, but eventually is minutes, and the socket reports
// itself open for all of them.
const SILENCE_LIMIT_MS = 10000;

// ── The link ─────────────────────────────────────────────────────────────────

export { decodePacket };

export class SygaldryLink {
  constructor() {
    this.transport = null;       // 'serial' | 'websocket'
    this.name = 'mubone';
    this.state = {};             // last value seen for every address
    this.connected = false;
    this.listeners = new Set();
    // Measurement taps. Empty in normal use and checked with a .size test, so
    // the decode path pays one integer compare per message and nothing else —
    // the diagnostics page installs one for a few seconds and removes it.
    this._taps = new Set();
    this._gyro = null;
    this._accel = null;
    // Sensor data is held until the instrument says what it is called. Emitting
    // under the placeholder first registers a second, phantom sensor that stays
    // for the session, so the wait is generous: the refresh heartbeat asks
    // again every three seconds, and a name that has not arrived after ten is a
    // device that is never going to send one.
    this._nameKnown = false;
    this._kindDeclared = false;
    this._nameDeadline = 0;
    this._port = null;
    this._writer = null;
    this._socket = null;
    this._reading = null;
    this._closing = false;
    this._heartbeat = null;
    this._lastPacketAt = 0;
    // Where to dial, how long to wait, and whether a wait is running. Public so
    // the panel can say what is going on without keeping its own copy.
    this.retrying = false;
    this.retryHost = null;
    this.retryPort = 80;
    this.retryDelayMs = RETRY_MIN_MS;
    this._retryTimer = null;
    this._slip = new SlipDecoder((packet) => this._packet(packet));
  }

  // -- observation ----------------------------------------------------------

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify(event) { for (const fn of this.listeners) { try { fn(event, this); } catch (_) {} } }

  latest(address) { return this.state[address]; }

  /** Watch every decoded message. Returns a remove function. For measurement
      only: this runs in the decode path, so keep the callback cheap and take
      it off when done. */
  tap(fn) { this._taps.add(fn); return () => this._taps.delete(fn); }

  _packet(bytes) {
    this._lastPacketAt = performance.now();
    for (const { address, args } of decodePacket(bytes)) this._message(address, args);
  }

  _message(address, args) {
    if (this._taps.size) for (const t of this._taps) { try { t(address, args); } catch (_) {} }
    this.state[address] = args;
    // ONE instrument, ONE feed (Ek, 2026-09-09: "make sure there's no
    // doubling, super important"). Two links to the same instrument — the
    // cable and the wifi at once — each carried every packet into the same
    // sensor, so the cursor got each sample twice and the rate read double.
    // The newest link is the instrument's primary (_resolvePrimary); an older
    // one still connected forwards NOTHING to the app — not a sample, not a
    // button — until it is dropped, which _resolvePrimary does on the next
    // change. Name learning below still runs, so it can be identified.
    const p = this._nameKnown ? _primary.get(this.name) : null;
    const secondary = !!(p && p !== this && p.connected);

    // The instrument's buttons reach the palette BY POSITION (Ek, 2026-09-01;
    // the list palette 2026-09-11) — edges go to the button recogniser, whose
    // factory set (midi.js BUTTON_DEFAULTS) lands on palette_N_toggle /
    // palette_N_hold, so a button held is a tool playing exactly as a held key
    // is. Edge detection here, once per link; the ACTIONS table does the rest.
    if (address === '/Buttons/state' && !secondary) {
      const prev = this._btnPrev || [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const now = args[i] ? 1 : 0;
        // Bound on the keys page (midi.js buttonMappings) — the three palette
        // holds by default, anything by choice (Ek, 2026-09-09). Not hard-wired.
        if (now !== (prev[i] ? 1 : 0)) S._dispatchButton?.(i + 1, now === 1);
      }
      this._btnPrev = [args[0], args[1], args[2]];
    }

    if (address === '/WiFi/device_name' && args[0]) {
      if (args[0] !== this.name) { this.name = args[0]; this._notify('name'); }
      // Resolved HERE, not only on a name change: a link made from a remembered
      // record already carries the name, so no 'name' event fires, and without
      // this the newest link only became primary on the change after next.
      if (!this._nameKnown) { this._nameKnown = true; _resolvePrimary(); }
    }
    // Learning where the instrument lives is not a step anyone should have to
    // take: it announces its address, so remember it whenever it does.
    if (address === '/WiFi/station_ip' && typeof args[0] === 'string'
     && args[0].length > 0 && args[0] !== '0.0.0.0' && this._nameKnown) {
      // Only once the instrument has said what it is called — the record is
      // keyed by name, and the placeholder would file it under a name that
      // belongs to no instrument and would be handed to the next one.
      rememberInstrument(this.name, { address: args[0] });
    }

    if (secondary) return;
    const kind = SYGALDRY_TO_APP[address];
    // An instrument that never answers with a name still has to play; after a
    // couple of seconds, give up waiting and use the placeholder.
    if (kind && !this._nameKnown) {
      if (performance.now() < this._nameDeadline) return;
      this._nameKnown = true;
      _resolvePrimary();
    }
    if (kind === 'quaternion' && args.length >= 4) {
      handleOSC(`/sensor/${this.name}/quaternion`, args.slice(0, 4));
      // The slot exists only once a value has been through it, so the claim is
      // made after the first emit rather than on connect. Guarded by a flag
      // because this runs at the instrument's full report rate.
      if (!this._kindDeclared) {
        this._kindDeclared = !!declareSensorKind(
          this.name, 'mubone', this.transport === 'serial' ? 'cable' : 'wifi');
      }
      return;
    }
    // The app wants gyro and accel together; the instrument sends them as two
    // messages in the same bundle, so pair them and emit once both are in hand.
    if (kind === 'gyro' && args.length >= 3) { this._gyro = args.slice(0, 3); this._maybeInertial(); return; }
    if (kind === 'accel' && args.length >= 3) { this._accel = args.slice(0, 3); this._maybeInertial(); return; }

  }

  _maybeInertial() {
    if (!this._gyro || !this._accel) return;
    handleOSC(`/sensor/${this.name}/inertial`, [...this._gyro, ...this._accel]);
    this._gyro = this._accel = null;
  }

  // -- sending --------------------------------------------------------------

  async send(address, args = []) {
    // The card's Command log door reads this. Cap it — a set is long.
    S._cmdLog.push({ t: Date.now(), what: address });
    if (S._cmdLog.length > 200) S._cmdLog.shift();
    const payload = encodeOSC(address, args);
    if (this.transport === 'serial' && this._writer) {
      await this._writer.write(slipEncode(payload));
    } else if (this.transport === 'websocket' && this._socket
            && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(payload);
    }
  }

  refresh() { return this.send('/syg/refresh'); }
  describe() { return this.send('/syg/describe'); }

  /**
   * Keep asking for the whole picture, slowly.
   *
   * Values are only sent when they change, so everything that is not moving is
   * learned from a single refresh -- and a single refresh is a single message,
   * which the instrument will drop like any other when its buffer is full. One
   * lost message would otherwise leave a panel full of dashes until the next
   * reconnect. Three seconds is far below the cost of one sensor frame.
   *
   * Because every one of those is answered, the same timer doubles as the
   * liveness check: see SILENCE_LIMIT_MS.
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._lastPacketAt = performance.now();
    this._heartbeat = setInterval(() => {
      if (!this.connected) return;
      if (this.transport === 'websocket'
       && performance.now() - this._lastPacketAt > SILENCE_LIMIT_MS) {
        // Nothing has answered in three heartbeats. Calling it lost is what puts
        // the retry in motion; waiting for the socket to admit it is not.
        this.disconnect('lost');
        return;
      }
      this.refresh();
    }, 3000);
  }

  _stopHeartbeat() {
    if (this._heartbeat) clearInterval(this._heartbeat);
    this._heartbeat = null;
  }


  // -- the cable ------------------------------------------------------------

  /** Ask the browser for a port. Must be called from a click. */
  async connectSerial(filters = SYGALDRY_USB_FILTERS) {
    if (!navigator.serial) throw new Error('this browser has no Web Serial');
    let port;
    const granted = await navigator.serial.getPorts();
    port = granted.find((p) => matchesFilter(p, filters));
    if (!port) port = await navigator.serial.requestPort({ filters });
    // 115200 and never 1200: opening at 1200 and dropping DTR reboots an RP2350
    // into its bootloader, and the instrument vanishes mid-session.
    await port.open({ baudRate: 115200 });
    this._port = port;
    this._writer = port.writable.getWriter();
    this.transport = 'serial';
    this.connected = true;
    this._nameKnown = false;
    this._kindDeclared = false;
    this._nameDeadline = performance.now() + 10000;
    this._notify('connected');
    this._startHeartbeat();
    this._readLoop(port);
    // Refresh only. A describe is sixty-odd separate replies and would arrive
    // ahead of the state we actually want; ask for it when something needs it.
    await this.refresh();
    return port;
  }

  async _readLoop(port) {
    const reader = port.readable.getReader();
    this._reading = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this._slip.push(value);
      }
    } catch (_) {
      // a disconnect surfaces here; disconnect() reports it once
    } finally {
      try { reader.releaseLock(); } catch (_) {}
      if (this.transport === 'serial') this.disconnect('lost');
    }
  }

  // -- coming back ----------------------------------------------------------

  /** Stop trying, and forget where we were trying to reach. */
  stopRetrying() {
    this._cancelRetry();
    this.retryHost = null;
  }

  _cancelRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this.retrying = false;
  }

  _scheduleRetry() {
    if (this._retryTimer || !this.retryHost) return;
    this.retrying = true;
    this._notify('retrying');
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._retry();
    }, this.retryDelayMs);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
  }

  async _retry() {
    if (this.connected) return;          // something else got there first
    this._notify('retry-attempt');
    // One attempt in flight at a time, and a failed one always closes its socket:
    // an abandoned connection still occupies one of the instrument's four client
    // slots for five seconds, so a retry loop tighter than that can lock itself
    // out of the very instrument it is chasing. connectWebSocket does the closing.
    try { await this.connectWebSocket(this.retryHost, this.retryPort); }
    catch (_) { this._scheduleRetry(); }
  }

  // -- the network ----------------------------------------------------------

  async connectWebSocket(host, port = 80) {
    // Any deliberate attempt supersedes a scheduled one; two sockets racing for
    // the same slot is how a reconnect makes things worse instead of better.
    this._cancelRetry();
    this.retryHost = host;
    this.retryPort = port;
    const url = `ws://${host}${port === 80 ? '' : ':' + port}/`;
    const socket = new WebSocket(url, 'osc');
    socket.binaryType = 'arraybuffer';
    this._socket = socket;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no answer from ${host}`)), 8000);
        socket.onopen = () => { clearTimeout(timer); resolve(); };
        socket.onerror = () => { clearTimeout(timer); reject(new Error(`could not reach ${host}`)); };
      });
    } catch (e) {
      // Close it, always. A connection left hanging still occupies one of the
      // instrument's four client slots, so giving up without closing is how a
      // few failed attempts used to make the instrument unreachable entirely.
      try { socket.close(); } catch (_) {}
      this._socket = null;
      throw e;
    }
    socket.onmessage = (event) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) this._packet(new Uint8Array(data));
    };
    socket.onclose = () => { if (this.transport === 'websocket') this.disconnect('lost'); };
    this.transport = 'websocket';
    this.connected = true;
    this.address = host;
    this.retryDelayMs = RETRY_MIN_MS;   // it answered; start the backoff over
    this._nameKnown = false;
    this._kindDeclared = false;
    this._nameDeadline = performance.now() + 10000;
    this._notify('connected');
    this._startHeartbeat();
    await this.refresh();
    return socket;
  }

  // -- changing what the instrument is doing --------------------------------
  //
  // Every one of these is a write and nothing more. The instrument decides what
  // happens next and publishes it; there is no result to await here, because
  // the answer is not ours to compute -- it arrives as state, like everything
  // else the instrument has to say.

  /** Hand over credentials and restart the radio with them. */
  async join(ssid, password) {
    await this.send('/WiFi/ssid', [['s', ssid]]);
    await this.send('/WiFi/password', [['s', password]]);
    // Writing credentials alone changes nothing: sygbr-wifi only calls
    // connect() when enable_station is written, and writing the value it
    // already holds does not count. Measured on the hardware, not assumed.
    await this.send('/WiFi/enable_station', [['i', 0]]);
    // Over a cable, put the two writes far enough apart to land in different
    // passes of the instrument's loop: sent together they collapse into a
    // single write of 1, the radio is never actually taken down, and joining
    // from an existing association takes minutes where a clean restart takes
    // seconds.
    //
    // Over the radio they must go together, because the first one is what kills
    // the connection carrying the second. Waiting here strands the instrument
    // with its radio off, reachable only by walking over with a cable.
    if (this.transport === 'serial') await new Promise((r) => setTimeout(r, 400));
    return this.send('/WiFi/enable_station', [['i', 1]]);
  }

  /** Turn the station radio on or off. */
  station(on) {
    return this.send('/WiFi/enable_station', [['i', on ? 1 : 0]]);
  }

  /** The instrument's own network, up or down (sygbr-wifi `enable_access_point`,
   *  2026-09-10). Independent of the station: bringing it up or down never
   *  touches the router link. It reads its name, password and address when it
   *  comes up, and the firmware re-runs that on every write of 1 — so a
   *  changed name takes effect by sending 1 again, whether or not it is up.
   *  A persisted 1 does NOT bring it up at boot: Wifi::init starts the
   *  station only, so this has to be sent again after every power-up. */
  accessPoint(on) {
    return this.send('/WiFi/enable_access_point', [['i', on ? 1 : 0]]);
  }

  /** Name and password for the access point. Both write-only on the
   *  instrument, both persisted there; an empty one is left alone, so the
   *  instrument keeps its own name and the factory password. The values are
   *  read when the AP comes up — the caller decides whether to restart it. */
  async accessPointConfig(ssid, password) {
    if (ssid)     await this.send('/WiFi/ap_ssid',     [['s', ssid]]);
    if (password) await this.send('/WiFi/ap_password', [['s', password]]);
  }

  /** Rename the instrument; an empty name restores the one derived from its board ID. */
  rename(name) {
    return this.send('/WiFi/name', [['s', name]]);
  }

  /**
   * Set the status LED.
   *
   * Three channel intensities, each 0 to 1 and linear in light: this is duty
   * cycle, not a screen colour, so anything that starts life as an sRGB hex has
   * to be linearised before it gets here. What a given triple looks like is a
   * property of the LED and its ballast resistors and is not knowable from this
   * side of the wire -- see page-sygsr-rgb_led for why the firmware refuses to
   * guess either.
   */
  // ── The BNO085's own control surface (docs/BNO085-CONTROL.md § 2) ─────────
  //
  // Type tags are load-bearing here in a way they are nowhere else in this
  // file: sygbp-osc's match() does a strcmp on the tag string as well as the
  // address, so a float sent at an ,i endpoint is dropped without a word and
  // without an error. Every tag below is from the firmware's own table.
  //
  // `persist_calibration` is deliberately absent. § 3.1: it sends command 0x09
  // (configure PERIODIC DCD save) where saving on demand is 0x06, so it does
  // not do what its name says and cannot report that it failed. A button
  // labelled "save calibration" would be a lie until the firmware is fixed.

  /** Zero the orientation. Runtime only — see persistTare. */
  tare() { return this.send('/BNO085/tare_sensor', []); }

  /** Write the current tare to the sensor's System Orientation FRS record. */
  persistTare() { return this.send('/BNO085/persist_tare', []); }

  /** Hardware reset pulse; re-runs the handshake and re-applies the rate. */
  resetSensor() { return this.send('/BNO085/reset', []); }

  /** Bitfield: 1 accelerometer, 2 gyroscope, 4 magnetometer. */
  calibration(bits) {
    return this.send('/BNO085/enable_calibration', [['i', bits & 7]]);
  }

  /** Named for what we want, not for the endpoint: the firmware's flag is
      `disable_magnetometer`, so the sense is inverted exactly once, here. */
  magnetometer(on) {
    return this.send('/BNO085/disable_magnetometer', [['i', on ? 0 : 1]]);
  }

  /** One interval shared by gyro, linear accel and the rotation vector.
      The driver hand-clamps because the framework does not; so do we. */
  samplingRate(hz) {
    const v = Math.max(0, Math.min(400, Number(hz) || 0));
    return this.send('/BNO085/sampling_rate', [['f', v]]);
  }

  led(r, g, b) {
    return this.send('/LED/color', [['f', r], ['f', g], ['f', b]]);
  }

  /**
   * Has this instrument told us it has an LED?
   *
   * Only a describe answers this, and connect deliberately does not send one.
   * Whoever needs the answer asks for it; until the reply lands this reads
   * false, which is the right way to treat an instrument that has not said.
   */
  get hasLed() { return Array.isArray(this.state['/describe/inputs/LED/color']); }

  async disconnect(reason = 'closed') {
    // Anything but a loss is somebody's decision, and it has to survive the early
    // returns below -- during a retry wait there is no socket left to close, so
    // that is exactly when a stop request would otherwise fall through the floor.
    if (reason !== 'lost') this._cancelRetry();
    if (this._closing) return null;
    if (!this.connected && !this._port && !this._socket) return null;
    this._closing = true;
    const was = this.transport;
    this._stopHeartbeat();
    this.connected = false;
    this.transport = null;

    // Order matters and every step has to be awaited. A port whose reader still
    // holds a lock will not close, and a port that does not close stays claimed
    // by this tab -- which is how a reload used to leave the instrument locked
    // away until the whole browser was quit.
    try { await this._reading?.cancel(); } catch (_) {}
    try { this._reading?.releaseLock(); } catch (_) {}
    try { this._writer?.releaseLock(); } catch (_) {}
    try { await this._port?.close(); } catch (_) {}
    try { this._socket?.close(); } catch (_) {}

    this._port = this._writer = this._socket = this._reading = null;
    this._closing = false;
    // A button held when the link went is released here, or its hold action
    // stays down with nothing left to let go of it.
    for (let i = 0; i < 3; i++) if (this._btnPrev?.[i]) S._dispatchButton?.(i + 1, false);
    this._btnPrev = null;
    // Everything in `state` is something an instrument that is no longer here
    // said. Keeping it is how a fact about one instrument gets read back as a
    // fact about the next one plugged in -- and the answers that are only ever
    // asked once per connection, like whether there is an LED to drive, are
    // exactly the ones that would never be corrected.
    this.state = {};
    this._notify(reason === 'lost' ? 'lost' : 'disconnected');
    if (reason === 'lost' && was === 'websocket') this._scheduleRetry();
    return was;
  }
}

// ── Remembering where each instrument was ────────────────────────────────────
//
// One record per instrument, keyed by the name the instrument reports. That
// name is its own, is what it registers as a sensor under, and is stable across
// sessions — which is what makes it the right key once there can be more than
// one of these on a rig. The two single-slot keys this replaces could only ever
// describe "the" instrument.

const KNOWN_KEY = 'mubone_sygaldry_known';   // { [name]: { ssid, address } }

function _readKnown() {
  try { return JSON.parse(localStorage.getItem(KNOWN_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}

function _writeKnown(all) {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify(all)); } catch (_) {}
}

/** Every instrument this rig has been introduced to. */
export function knownInstruments() {
  const all = _readKnown();
  return Object.keys(all).map((name) => ({ name, ...all[name] }));
}

export function rememberedFor(name) {
  if (!name) return null;
  return _readKnown()[name] || null;
}

export function rememberInstrument(name, { ssid, address } = {}) {
  // The password is deliberately not kept. The instrument persists its own, so
  // rejoining works without it, and a wifi password does not belong in
  // localStorage where every script on the page can read it.
  if (!name) return;
  const all = _readKnown();
  const rec = all[name] || {};
  if (ssid)    rec.ssid = ssid;
  if (address) rec.address = address;
  all[name] = rec;
  _writeKnown(all);
}

export function forgetInstrument(name) {
  if (!name) return;
  const all = _readKnown();
  delete all[name];
  _writeKnown(all);
}

// ── The set of instruments ───────────────────────────────────────────────────
//
// A rig can carry several. Each is its own SygaldryLink — the class was always
// self-contained, every field on `this`, so this is a list rather than a
// rewrite. The panel renders one block per entry.

const _links = [];
const _setListeners = new Set();
let _seq = 0;

export function links() { return _links.slice(); }

export function onLinksChanged(fn) {
  _setListeners.add(fn);
  return () => _setListeners.delete(fn);
}

function _notifySet() { _resolvePrimary(); for (const fn of _setListeners) { try { fn(); } catch (_) {} } }

// ── One instrument, one link ─────────────────────────────────────────────────
// Connecting over the cable while an instrument is on wifi, or the other way
// round, used to ADD a link and drop nothing: both fed the same sensor (every
// packet twice) and the device's one `via` field showed whichever link had
// declared its wire LAST — the mark flipped to usb on a wifi connect, and stayed
// on a wire that had gone (Ek, 2026-09-09). Now the newest connection to a name
// is that instrument's primary: older links to the same name are dropped, a
// retrying one is stopped, and the wire is re-derived from the survivor on every
// change, so the mark is the wire actually carrying the feed.
const _primary = new Map();   // name → the link whose packets reach the app
let _resolving = false;
function _resolvePrimary() {
  if (_resolving) return;
  _resolving = true;
  try {
    const byName = new Map();
    for (const l of _links) {
      if (!l._nameKnown || !l.name) continue;
      if (!l.connected && !l.retrying) continue;
      const cur = byName.get(l.name);
      // Connected beats retrying; among the connected, the newest (highest id).
      if (!cur || (l.connected && !cur.connected) || (l.connected === cur.connected && l.id > cur.id)) byName.set(l.name, l);
    }
    _primary.clear();
    const losers = [];
    for (const [name, win] of byName) {
      _primary.set(name, win);
      for (const l of _links) if (l !== win && l._nameKnown && l.name === name && (l.connected || l.retrying)) losers.push(l);
    }
    for (const l of losers) {
      l.stopRetrying();
      l.disconnect('closed').catch(() => {});
      const i = _links.indexOf(l);
      if (i >= 0) _links.splice(i, 1);
    }
    // The wire the feed is actually on, re-declared on every change.
    for (const [name, win] of _primary) {
      if (win.connected) declareSensorKind(name, 'mubone', win.transport === 'serial' ? 'cable' : 'wifi');
    }
    if (losers.length) queueMicrotask(_notifySet);
  } finally { _resolving = false; }
}

/** A new, unconnected link. Drop it again if the connection is refused. */
export function addLink() {
  const l = new SygaldryLink();
  l.id = ++_seq;
  l.onChange(() => _notifySet());
  _links.push(l);
  _notifySet();
  return l;
}

export async function dropLink(l) {
  const i = _links.indexOf(l);
  if (i < 0) return;
  _links.splice(i, 1);
  l.stopRetrying();
  try { await l.disconnect(); } catch (_) {}
  _notifySet();
}

/** The link an app-side sensor name belongs to, or null. */
export function linkForSensor(name) {
  return _links.find((l) => l.connected && l.name === name) || null;
}

// ── USB identity ─────────────────────────────────────────────────────────────
// The Pi's vendor ID with the SDK's stdio product ID. Filtering on it is what
// reduces the browser's port picker to a single obvious entry.

export const SYGALDRY_USB_FILTERS = [{ usbVendorId: 0x2e8a }];

function matchesFilter(port, filters) {
  const info = port.getInfo?.() ?? {};
  return filters.some((f) =>
    (f.usbVendorId === undefined || f.usbVendorId === info.usbVendorId) &&
    (f.usbProductId === undefined || f.usbProductId === info.usbProductId));
}



// A serial port stays claimed by this tab until it is closed, and a reload does
// not do that for us. Without this, refreshing the page left the instrument
// locked away until the browser itself was quit.
if (typeof window !== 'undefined') {
  // Every link, not a `link` that never existed here — the ReferenceError was
  // swallowed and the release was a no-op until 2026-09-16.
  const release = () => { for (const l of _links) { try { l.disconnect('unload'); } catch (_) {} } };
  window.addEventListener('pagehide', release);
  window.addEventListener('beforeunload', release);
}
