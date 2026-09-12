// ============================================================================
// ui-sygaldry.js — the mubone instrument panels in sensor setup
//
// An instrument keeps its own state and publishes it. A panel is a window onto
// that, not a second copy of it: rows declare the address they show and paint()
// fills them, writes are sent and forgotten, and what happens next arrives the
// same way everything else does — as a value.
//
// A rig can carry several instruments, so there is one block per attached one,
// cloned from #sygInstrumentTpl and bound to its own link. Nothing here is
// addressed by id below the section level — an id can only describe one of
// something, and there can be two.
//
// The only judgements made here are the ones a person would otherwise have to
// make from the raw values: what "Joining" for a long time usually means, or
// that a perfect stream still moves nothing while the camera is elsewhere.
// ============================================================================

import { S } from './state.js';
import {
  links, addLink, dropLink, onLinksChanged, unsupportedReason,
  knownInstruments, rememberedFor, rememberInstrument, forgetInstrument,
} from './sygaldry.js';

let _painting = null;

// link → its block, and the little bit of state that belongs to the PANEL
// rather than the instrument: what we asked for and when. The instrument is
// the authority on what is happening; this is only what we requested.
const _blocks = new Map();
const _asked  = new Map();   // link → { want, at } | null
const _joined = new Map();   // link → timestamp of the last credential handover
const _everUp = new Set();   // links that have been connected at least once
const _apAsked = new Map();  // link → when its access-point switch was last pressed

function el(id) { return document.getElementById(id); }
function ask(link)    { return _asked.get(link) || null; }
function joinedAt(link) { return _joined.get(link) || 0; }

// ── The attach badge ─────────────────────────────────────────────────────────
// The kit's section-status element (docs/SETTINGS-GUI.md § 3): working is the
// ochre "reconnecting" face, bad the brick "no signal" one. Empty collapses it.

const STATUS_FACE = { working: ' set-badge--warn', bad: ' set-badge--err' };

function status(text, kind = '') {
  const node = el('sygStatus');
  if (!node) return;
  node.textContent = text;
  node.className = 'set-badge' + (STATUS_FACE[kind] || '');
}

// ── Painting ─────────────────────────────────────────────────────────────────
// One pass per block over every element that named an address. Formatters are
// the only place that knows how a kind of value should read.

const FORMAT = {
  // The calibration bitfield, as words — the device's OWN answer, which is
  // what makes the three checkboxes beside it trustworthy (Ek, 2026-09-01:
  // "i don't know if the toggles are true off the device… i want more
  // certainty than not").
  calbits: (v) => { const b = Array.isArray(v) ? v[0] : v;
    if (b == null) return '—';
    const w = []; if (b & 1) w.push('accel'); if (b & 2) w.push('gyro'); if (b & 4) w.push('mag');
    return w.length ? w.join('+') : 'off'; },
  text: (v) => (v[0] === '' || v[0] === undefined ? '—' : String(v[0])),
  int:  (v) => String(Math.round(v[0])),
  hz:   (v) => v[0].toFixed(1) + ' Hz',
  vec:  (v) => v.map((n) => (n < 0 ? '' : ' ') + n.toFixed(3)).join('  '),
  pct:  (v) => v[0].toFixed(1) + '% lost',
  // The sensor reports heading confidence in radians, which is not a unit
  // anyone reads a rig in. Degrees, and the number is a ± not a measurement.
  deg:  (v) => '±' + (v[0] * 180 / Math.PI).toFixed(1) + '°',
  // SH-2 accuracy is 2 bits, 0 unreliable → 3 high. A number 0..3 says nothing
  // on its own, and this is the field that explains a jittery sphere.
  qual: (v) => ['unreliable', 'low', 'medium', 'high'][v[0]] ?? String(v[0]),
};

function value(link, address) {
  const v = link.latest(address);
  return v === undefined ? null : v;
}

function first(link, address) {
  const v = value(link, address);
  return v === null ? null : v[0];
}

// Walk [data-osc] under any root and paint the link's latest values — the
// block uses it, and Diagnostics reuses it for the instrument stream (R8),
// which is what keeps the formats one set instead of two.
export function paintOscInto(root, link) {
  for (const node of root.querySelectorAll('[data-osc]')) {
    const v = value(link, node.dataset.osc);
    const text = v === null ? '—' : (FORMAT[node.dataset.fmt] || FORMAT.text)(v);
    if (node.textContent !== text) node.textContent = text;
  }
}

function paint() {
  for (const [link, block] of _blocks) {
    if (!link.connected) continue;

    paintOscInto(block, link);

    const dot = block.querySelector('.js-sygStationDot');
    if (dot) dot.className = 'js-sygStationDot syg-dot ' + dotKind(first(link, '/WiFi/station_status'));
    const apDot = block.querySelector('.js-sygApDot');
    if (apDot) apDot.className = 'js-sygApDot syg-dot ' + apDotKind(first(link, '/WiFi/ap_status'));

    // Which network: the firmware's `ssid` is write-only (sygbr-wifi.hpp), so
    // the instrument cannot say what it is on; what mubone last asked it to
    // join is the one honest word, and it is said as that (Ek, 2026-09-09).
    const net = block.querySelector('.js-sygNet');
    if (net) {
      const ssid = link.name ? rememberedFor(link.name)?.ssid : null;
      const want = ssid ? `asked for ${ssid}` : 'network not reported';
      if (net.textContent !== want) net.textContent = want;
    }

    const buttons = first(link, '/Buttons/state') === null ? null : value(link, '/Buttons/state');
    const dots = block.querySelector('.js-sygButtons');
    if (dots && buttons) {
      for (let i = 0; i < 3; i++) dots.children[i]?.classList.toggle('on', !!buttons[i]);
    }

    paintControls(link, block);
    renderNotes(link, block);
  }
}

// What the sensor says it is set to, painted back onto the controls that set
// it. Never while a control is being used, or a value would change under the
// hand doing it.
function paintControls(link, block) {
  const q = (cls) => block.querySelector('.js-' + cls);

  const bits = first(link, '/BNO085/calibration_enabled');
  if (bits !== null) {
    const set = (el, on) => { if (el && document.activeElement !== el) el.checked = on; };
    set(q('sygCalA'), !!(bits & 1));
    set(q('sygCalG'), !!(bits & 2));
    set(q('sygCalM'), !!(bits & 4));
  }

  // The access point DOES publish itself (`ap_enabled`, unlike the station),
  // so its switch is painted from the instrument — except in the seconds
  // after a press, or the switch would snap back before the radio answers.
  const ap = q('sygAp');
  const apOn = first(link, '/WiFi/ap_enabled');
  if (ap && apOn !== null && document.activeElement !== ap && performance.now() - (_apAsked.get(link) || 0) > 4000) {
    ap.checked = !!apOn;
  }

  const rate = q('sygRate');
  const configured = first(link, '/BNO085/configured_rate');
  if (rate && configured !== null && document.activeElement !== rate && rate.value === '') {
    rate.value = String(Math.round(configured));
  }
}

// The radio's link status is the only honest source here. /WiFi/station_enabled
// sounds like it says whether the station is switched on; it is set to 1 only
// while the link is up, and 0 for every other state, so it answers a question
// nobody asked and would have this dot lying during a join.
function dotKind(state) {
  if (state === 'Up') return 'good';
  if (state === 'Joining' || state === 'No IP') return 'working';
  if (state === 'Down' || state === null) return 'off';
  return 'bad';
}
// The access point's three words (sygbr-wifi.cpp): Up, Down, and No DHCP —
// an interface that cannot hand out addresses is not up, whatever the radio
// says, and that one is a fault rather than a state in between.
function apDotKind(state) {
  if (state === 'Up') return 'good';
  if (state === 'Down' || state === null) return 'off';
  return 'bad';
}

// ── Reading the tea leaves ───────────────────────────────────────────────────
// Only where a value means something a person would not guess. Everything that
// speaks for itself is left to speak for itself.

function renderNotes(link, block) {
  const notes = [];
  const state = first(link, '/WiFi/station_status');
  const ip = first(link, '/WiFi/station_ip');

  if (state === 'Joining') {
    const waiting = joinedAt(link) && performance.now() - joinedAt(link) > 15000;
    notes.push([waiting ? 'bad' : 'working',
      waiting ? 'still joining after fifteen seconds — a wrong password looks exactly like this'
              : 'joining takes a few seconds']);
  }
  // What we asked for is ours to remember; what is happening is the
  // instrument's to say. When the two disagree for long enough to notice, say
  // so plainly rather than pretending either one is the whole truth.
  const asked = ask(link);
  if (asked && performance.now() - asked.at > 5000) {
    const settled = asked.want === 'off'
      ? (state === 'Down' || state === 'No network')
      : (state === 'Up');
    if (!settled) {
      const seconds = Math.round((performance.now() - asked.at) / 1000);
      notes.push(['warn', `the radio was asked to ${asked.want} ${seconds} seconds ago `
                        + `and still reports ${state}`]);
    } else {
      _asked.set(link, null);
    }
  }

  if (state === 'Bad auth') notes.push(['bad', 'the network refused that password']);
  if (state === 'No network') notes.push(['bad', 'no network of that name is in range']);
  if (state === 'Up' && !ip) notes.push(['working', 'joined; waiting to be given an address']);

  const rate = first(link, '/BNO085/report_rate');
  const configured = first(link, '/BNO085/configured_rate');
  if (rate !== null && configured && rate < configured * 0.6) {
    notes.push(['bad', `the sensor is reporting ${Math.round(rate)} times a second `
                     + `where ${configured} was asked for`]);
  }

  // A perfect stream still moves nothing if the camera is following something
  // else, and nothing sets that automatically.
  if (S.cameraMode !== 'sensor') {
    notes.push(['warn', `camera mode is “${S.cameraMode}” — the instrument will not move the sphere`, 'sensor']);
  }

  // (The standing "joining from here will drop this connection" warning is
  // gone — Ek, 2026-09-01. The Join button's own tooltip can carry the caveat
  // at the moment it matters; a permanent note was noise.)

  const box = block.querySelector('.js-sygNotes');
  if (!box) return;
  const key = JSON.stringify(notes);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.textContent = '';
  for (const [kind, text, fix] of notes) {
    const row = document.createElement('div');
    row.className = 'syg-note syg-' + kind;
    row.textContent = text;
    if (fix) {
      const button = document.createElement('button');
      button.className = 'set-btn set-btn--sm';
      button.textContent = 'switch to sensor';
      button.addEventListener('click', () => { S._setCameraMode?.(fix); renderNotes(link, block); });
      row.appendChild(button);
    }
    box.appendChild(row);
  }
}

// ── Structure ────────────────────────────────────────────────────────────────

function bindBlock(link, block) {
  const q = (cls) => block.querySelector('.js-' + cls);

  q('sygDisconnect')?.addEventListener('click', async () => {
    await dropLink(link);
    render();
  });

  // (the Show checkbox went with the one-line Router row, 2026-09-01)
  q('sygShowPassword')?.addEventListener('change', (e) => {
    const pw = q('sygPassword');
    if (pw) pw.type = e.target.checked ? 'text' : 'password';
  });

  q('sygJoin')?.addEventListener('click', () => {
    const ssidEl = q('sygSsid');
    const ssid = (ssidEl?.value || '').trim();
    if (!ssid) { ssidEl?.focus(); return; }
    _joined.set(link, performance.now());
    _asked.set(link, { want: 'join', at: performance.now() });
    if (link.name) rememberInstrument(link.name, { ssid });
    link.join(ssid, q('sygPassword')?.value || '');
    const pw = q('sygPassword');
    if (pw) pw.value = '';
    paint();
  });

  // ── The sensor's own control surface (docs/BNO085-CONTROL.md § 2) ─────────

  const _stamp = (cls) => { const el2 = q(cls);
    if (el2) el2.textContent = 'sent ' + new Date().toTimeString().slice(0, 5); };
  q('sygTare')?.addEventListener('click', () => { link.tare(); _stamp('sygTareSent'); });
  q('sygPersistTare')?.addEventListener('click', () => { link.persistTare(); _stamp('sygTareSent'); });

  // The firmware publishes no magnetometer on/off readback — the honest label
  // is when we last sent, not a state we cannot verify.
  q('sygMag')?.addEventListener('change', (e) => { link.magnetometer(e.target.checked); _stamp('sygMagSent'); });

  // One bitfield, three boxes. Sent whole on every change because the endpoint
  // takes the whole field — there is no way to set one bit.
  const calBits = () =>
    (q('sygCalA')?.checked ? 1 : 0) |
    (q('sygCalG')?.checked ? 2 : 0) |
    (q('sygCalM')?.checked ? 4 : 0);
  for (const c of ['sygCalA', 'sygCalG', 'sygCalM']) {
    q(c)?.addEventListener('change', () => link.calibration(calBits()));
  }

  const applyRate = () => {
    const v = Number(q('sygRate')?.value);
    if (Number.isFinite(v)) link.samplingRate(v);
  };
  q('sygRateApply')?.addEventListener('click', applyRate);
  q('sygRate')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyRate(); });

  // The one destructive control on the page, so it asks. A reset mid-set is a
  // second of silence and a re-handshake, which is not what a mis-click wants.
  q('sygReset')?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Reset'; link.resetSensor(); return; }
    b.dataset.armed = '1';
    b.textContent = 'Sure?';
    setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Reset'; } }, 4000);
  });

  // Two buttons rather than one toggle: nothing the instrument publishes says
  // whether its station is switched on, so a toggle would have to guess a label.
  // A button named for what it does is right whatever the radio is doing.
  q('sygRadioOn')?.addEventListener('click', () => {
    _asked.set(link, { want: 'on', at: performance.now() });
    link.station(true);
  });
  q('sygRadioOff')?.addEventListener('click', () => {
    _asked.set(link, { want: 'off', at: performance.now() });
    link.station(false);
  });

  // The access point (2026-09-10). A SWITCH, because the instrument reports
  // it back (`ap_enabled`); paintControls follows the report once the radio
  // has had its seconds. Name and password are sent on Set and read by the
  // firmware when the AP comes up, so Set re-sends the 1 if it is on — the
  // radio restarts with the new name, and a laptop on it has to rejoin.
  q('sygAp')?.addEventListener('change', (e) => {
    _apAsked.set(link, performance.now());
    link.accessPoint(e.target.checked);
  });
  q('sygApSet')?.addEventListener('click', async () => {
    const ssid = (q('sygApSsid')?.value || '').trim();
    const pw = q('sygApPassword')?.value || '';
    await link.accessPointConfig(ssid, pw);
    if (q('sygApPassword')) q('sygApPassword').value = '';
    if (first(link, '/WiFi/ap_enabled')) { _apAsked.set(link, performance.now()); link.accessPoint(true); }
  });
}

function render() {
  const tpl = el('sygInstrumentTpl');
  if (!tpl) return;

  // A link that connected, then went, and is not retrying is finished. Without
  // this it stays in the set for the life of the session — invisible, because
  // rendering filters on `connected`, but one more every reconnect.
  for (const l of links()) {
    if (l.connected) { _everUp.add(l); continue; }
    if (_everUp.has(l) && !l.retrying) { _everUp.delete(l); dropLink(l); }
  }

  const live = links().filter((l) => l.connected);

  // Whatever this browser is missing matters only while nothing is attached;
  // once an instrument is talking, saying it cannot be reached is just wrong.
  const blocked = live.length ? null : unsupportedReason();
  const unsup = el('sygUnsupported');
  if (unsup) {
    unsup.style.display = blocked ? '' : 'none';
    if (blocked) unsup.textContent = blocked;
  }

  // Reconcile blocks to links: drop what has gone, build what is new, and leave
  // the rest alone so a half-typed network name survives another instrument
  // connecting — or this sensor's card being re-rendered under it.
  for (const [link, block] of [..._blocks]) {
    if (live.includes(link)) continue;
    block.remove();
    _blocks.delete(link);
    _asked.delete(link);
    _joined.delete(link);
  }
  for (const link of live) {
    if (_blocks.has(link)) continue;
    const block = tpl.content.firstElementChild.cloneNode(true);
    _blocks.set(link, block);
    bindBlock(link, block);
    S._wireDisclosures?.(block);
  }

  for (const [link, block] of _blocks) {
    const via = block.querySelector('.js-sygVia');
    if (via) via.textContent = link.transport === 'websocket' ? `wifi ${link.address}` : 'cable';
    const ssid = block.querySelector('.js-sygSsid');
    if (ssid && document.activeElement !== ssid && !ssid.value) {
      ssid.value = rememberedFor(link.name)?.ssid || '';
    }
  }

  // The card puts a block on screen and the LIST carries the connect offers;
  // ask both to re-read the set.
  S._refreshSensorCard?.();
  S._refreshSensorList?.();

  if (live.length) startPainting(); else stopPainting();
}

// The sensor card asks for the block belonging to the device row it is drawing.
// A lookup, never a build — the block is bound and may be holding a half-typed
// password, so it is lent out and handed back, not recreated.
function blockFor(dev) {
  if (!dev || typeof dev.sn !== 'string' || !dev.sn.startsWith('osc-')) return null;
  for (const [link, block] of _blocks) {
    if (link.connected && link.name === dev.sn.slice(4)) return block;
  }
  return null;
}

// One button per instrument this rig knows and is not already talking to.
// Typing an address is not a thing anyone should have to do.
// ── Known instruments are DEVICE LIST rows, not buttons in Sources ─────────
// (Ek, 2026-09-01: "if it's able to say connect amber-blenny that means it
// sees amber-blenny — that should be shown in the list of devices i can
// connect to.") The offers are served as data; ui-imu-setup renders them as
// rows of the one sensor list and calls back into the two verbs below.
export function sygOffers() {
  const liveNames = new Set(links().filter(l => l.name).map(l => l.name));
  return knownInstruments().filter(k => k.address && !liveNames.has(k.name));
}
export async function sygConnectKnown(k) { await connectWifi(k); }
// The USB attach, callable from the sensor list's own rows (#320: the header
// buttons are gone — Rescan and the rows carry every connect).
export async function sygConnectSerial() { await connectUsb(); }
export function sygForgetKnown(name) {
  forgetInstrument(name);
  S._refreshSensorList?.();
}

function startPainting() {
  if (_painting) return;
  // Ten times a second: fast enough that a status change feels immediate, slow
  // enough to be free next to a sensor arriving three hundred times a second.
  _painting = setInterval(paint, 100);
  paint();
}

function stopPainting() {
  if (!_painting) return;
  clearInterval(_painting);
  _painting = null;
}

// ── The one thing that needs a click ─────────────────────────────────────────

async function connectUsb() {
  const link = addLink();
  try {
    status('choose the instrument in the browser’s list…', 'working');
    await link.connectSerial();
    status('');
  } catch (e) {
    // A link that never connected is not an instrument; take it back out so an
    // empty block never appears.
    await dropLink(link);
    status(/No port selected/i.test(e.message)
      ? 'no device chosen — press connect again'
      : `could not connect: ${e.message}`, 'bad');
  }
  render();
}

async function connectWifi(known) {
  if (!known?.address) return;
  const link = addLink();
  try {
    status(`looking for ${known.name} at ${known.address}…`, 'working');
    await link.connectWebSocket(known.address);
    status('');
  } catch (e) {
    await dropLink(link);
    status(`no answer from ${known.address} — ${known.name} may be off, or on another `
         + 'address now. Plug in the cable to find out.', 'bad');
  }
  render();
}

export function initSygaldryUI() {
  // The template is the module's only hard dependency now that the panel is
  // the selected sensor's card.
  if (!el('sygInstrumentTpl')) return;

  // (#320: no header attach button — the list's rows and Rescan call
  // sygConnectSerial/connectWifi directly.)
  S._sygaldryBlockFor = blockFor;

  onLinksChanged(() => {
    for (const link of links()) {
      if (link.retrying) {
        status(`${link.name} went away — trying ${link.retryHost} again in `
             + `${Math.round(link.retryDelayMs / 1000)}s`, 'working');
      }
    }
    render();
  });

  if (unsupportedReason()) status('this browser cannot reach an instrument', 'bad');
  render();
}
