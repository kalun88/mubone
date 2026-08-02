// ============================================================================
// ui-staging.js — Modal UI for the posture-macro staging engine (Change B)
//
// Sections:
//   - transport status (reuses MIDI/OSC availability from the sensor-mapping
//     banner, plus a start/stop toggle for the engine)
//   - interpolation controls (mode dropdown, sigma/k sliders, axis weights)
//   - channel editor (add/remove/rename, protocol + destination fields,
//     test send button)
//   - snapshot table (drop-from-live, edit values, identity coords, delete)
//   - mapping-preset library (save / load / delete presets)
//   - live readouts (identity vector, per-snapshot weights, per-channel
//     pre/wire values)
//
// Uses the same visual language as ui-sensor-mapping.js so the modal feels
// consistent with the rest of the staging surface.  All dispatch goes through
// snapshot-engine.js exports; this file never mutates S.staging directly
// (except via those exports) so state changes flow through a single path and
// always hit localStorage.
// ============================================================================

import { S } from './state.js';
import {
  initMIDIOut,
  isMIDIOutAvailable,
  isMIDIOutInitialized,
  listOutputs as listMIDIOutputs,
  onStateChange as onMIDIStateChange,
  sendCC as midiSendCC,
  testSend as midiTestSend,
} from './midi-out.js';
import {
  isOSCOutAvailable,
  testSend as oscTestSend,
} from './osc-out.js';
import {
  startStaging,
  stopStaging,
  captureSnapshot,
  deleteSnapshot,
  updateSnapshotValue,
  updateSnapshotLabel,
  addChannel,
  removeChannel,
  renameChannel,
  saveMappingPresetToLibrary,
  loadMappingPresetFromLibrary,
  deleteMappingPresetFromLibrary,
  setInterpolation,
  setLogging,
  saveStaging,
  _defaultChannel,
} from './snapshot-engine.js';
import {
  IDENTITY_AXES,
  IDENTITY_KEYS,
} from './relational-features.js';
import { KERNEL_LABELS } from './interp-kernels.js';
import {
  initPostureMap,
  destroyPostureMap,
  pokePostureMap,
  clearPostureSelection,
} from './ui-posture-map.js';
import {
  setOSCStreamDest,
  startOSCStream,
  stopOSCStream,
  isOSCStreamRunning,
  getOSCStreamDest,
} from './osc-stream.js';

let _modal        = null;
let _bodyRoot     = null;
let _isOpen       = false;

// Sub-panel root elements — cached so we can re-render sections in place.
let _banner       = null;
let _mapRoot      = null;
let _mapMounted   = false;
let _interpRoot   = null;
let _channelsRoot = null;
let _snapshotsRoot = null;
let _libraryRoot  = null;
let _readoutsRoot = null;
let _streamRoot   = null;

const TX_COLORS = {
  sent:        '#81c784',
  deduped:     '#8e8e8e',
  throttled:   '#ffb74d',
  unavailable: '#e57373',
  invalid:     '#e57373',
  held:        '#64b5f6',
  idle:        '#555',
};

// ── tiny DOM helpers ────────────────────────────────────────────────────────

function _el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') n.style.cssText = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    if (typeof c === 'string') n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  }
  return n;
}

function _fmtN(v, digits = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function _clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── Transport banner ────────────────────────────────────────────────────────

function _buildBanner() {
  const b = _el('div', { class: 'staging-banner' });
  _banner = b;
  _renderBanner();
  return b;
}

function _renderBanner() {
  if (!_banner) return;
  _clear(_banner);

  const midiOK = isMIDIOutAvailable();
  const midiInit = isMIDIOutInitialized();
  const oscOK  = isOSCOutAvailable();
  const running = !!(S.staging && S.staging.running);
  const devCount = listMIDIOutputs().length;

  // Engine toggle
  const toggle = _el('button', {
    class: 'staging-engine-btn',
    title: running ? 'stop the snapshot engine' : 'start the snapshot engine',
    onclick: () => { running ? stopStaging() : startStaging(); _renderAll(); },
  }, running ? '■ stop engine' : '▶ start engine');
  if (running) toggle.classList.add('running');
  _banner.appendChild(toggle);

  // MIDI status chip
  const midiChip = _el('span', { class: 'staging-chip', title: 'MIDI output transport status' }, [
    _el('span', { class: 'staging-dot', style: `background:${midiOK ? '#81c784' : '#e57373'}` }),
    'midi ' + (midiOK ? `(${devCount})` : midiInit ? '(no devices)' : '(not requested)'),
  ]);
  if (!midiInit) {
    const btn = _el('button', {
      class: 'staging-mini-btn',
      onclick: async () => { await initMIDIOut(); _renderBanner(); },
    }, 'request');
    midiChip.appendChild(btn);
  }
  _banner.appendChild(midiChip);

  // OSC status chip
  const oscChip = _el('span', { class: 'staging-chip', title: 'External OSC transport status' }, [
    _el('span', { class: 'staging-dot', style: `background:${oscOK ? '#81c784' : '#e57373'}` }),
    'osc ' + (oscOK ? '(available)' : '(electron only)'),
  ]);
  _banner.appendChild(oscChip);

  // Logging toggle
  const logCb = _el('input', { type: 'checkbox' });
  logCb.checked = !!(S.staging && S.staging.logging);
  logCb.addEventListener('change', () => setLogging(logCb.checked));
  _banner.appendChild(_el('label', { class: 'staging-log-lbl' }, [logCb, ' log to console']));
}

// ── Stream out (raw OSC pump for Max / SuperCollider) ──────────────────────
//
// Lives above the macro-engine UI because it's the "easy mode" path: send
// calibrated euler + the frame-cancelled delta out, do all mapping in Max.
// The macro engine below it stays available for when staging in mubone makes
// sense, but most early prototyping happens here.

function _buildStreamOut() {
  const root = _el('div', { class: 'staging-section' });
  _streamRoot = root;
  _renderStreamOut();
  return root;
}

function _renderStreamOut() {
  if (!_streamRoot) return;
  _clear(_streamRoot);

  const dest = getOSCStreamDest();
  const running = isOSCStreamRunning();

  // Header
  _streamRoot.appendChild(_el('div', { class: 'staging-section-title-row' }, [
    _el('span', { class: 'staging-section-title' }, 'stream out (osc → max)'),
    _el('span', { class: 'staging-section-hint' },
      'roll pitch yaw  ·  ±180° / ±90° / ±180°  ·  /delta = cursor relative to frame'),
  ]));

  // Destination + start/stop
  const ctlRow = _el('div', { class: 'staging-row' });

  const hostIn = _el('input', { type: 'text', value: dest.host, class: 'staging-host', title: 'destination host (e.g. 127.0.0.1 or another machine on the LAN)' });
  hostIn.addEventListener('change', () => {
    setOSCStreamDest(hostIn.value.trim() || '127.0.0.1', dest.port);
    _renderStreamOut();
  });
  ctlRow.appendChild(_el('label', { class: 'staging-lbl' }, ['host', hostIn]));

  const portIn = _el('input', { type: 'number', min: '1', max: '65535', step: '1', value: String(dest.port), class: 'staging-num-sm', title: 'destination port — set [udpreceive ' + dest.port + '] in Max to match' });
  portIn.addEventListener('change', () => {
    setOSCStreamDest(dest.host, parseInt(portIn.value, 10) || dest.port);
    _renderStreamOut();
  });
  ctlRow.appendChild(_el('label', { class: 'staging-lbl' }, ['port', portIn]));

  const toggle = _el('button', {
    class: 'staging-engine-btn',
    title: running ? 'stop sending' : 'start sending',
    onclick: () => { running ? stopOSCStream() : startOSCStream(); _renderStreamOut(); },
  }, running ? '■ stop stream' : '▶ start stream');
  if (running) toggle.classList.add('running');
  ctlRow.appendChild(toggle);

  _streamRoot.appendChild(ctlRow);

  // Live readouts — refreshed in-place by _updateStreamReadouts() on each tick.
  const readouts = _el('div', { class: 'staging-stream-readouts' });

  // Column header so the three numbers aren't anonymous.
  readouts.appendChild(_el('div', { class: 'staging-stream-row staging-stream-head' }, [
    _el('span', { class: 'staging-stream-addr' }, 'address'),
    _el('span', { class: 'staging-stream-vals' }, 'roll      pitch     yaw'),
  ]));

  // /delta line
  readouts.appendChild(_el('div', { class: 'staging-stream-row', 'data-stream-row': 'delta' }, [
    _el('span', { class: 'staging-stream-addr' }, '/delta'),
    _el('span', { class: 'staging-stream-vals', 'data-stream-vals': 'delta' }, '—'),
  ]));

  // Per-sensor lines — list at render time, refresh values on tick.
  const sensorsHost = _el('div', { 'data-sensors-host': '1' });
  readouts.appendChild(sensorsHost);

  _streamRoot.appendChild(readouts);
}

function _updateStreamReadouts() {
  if (!_isOpen || !_streamRoot) return;
  const sent = S.oscStream?.lastSent;
  if (!sent) return;
  const running = !!S.oscStream?.running;

  const deltaCell = _streamRoot.querySelector('[data-stream-vals="delta"]');
  if (deltaCell) {
    if (Array.isArray(sent.delta)) {
      deltaCell.textContent =
        _fmtN(sent.delta[0], 1) + '  ' +
        _fmtN(sent.delta[1], 1) + '  ' +
        _fmtN(sent.delta[2], 1);
      deltaCell.style.color = '';
    } else if (!running) {
      deltaCell.textContent = '—';
      deltaCell.style.color = '#666';
    } else {
      deltaCell.textContent = '(no cursor sensor)';
      deltaCell.style.color = '#888';
    }
  }

  // Sensor rows are dynamic — the registry can grow during a session.  Rebuild
  // the host element only if the set of names changed; otherwise just patch
  // the values in place so we're not thrashing DOM at 33Hz.
  const host = _streamRoot.querySelector('[data-sensors-host]');
  if (!host) return;
  const sensors = sent.sensors || {};
  const names = Object.keys(sensors).sort();
  const existing = Array.from(host.children).map(c => c.dataset.sensorName);
  const same = existing.length === names.length &&
    existing.every((n, i) => n === names[i]);
  if (!same) {
    _clear(host);
    for (const n of names) {
      // Address shown matches what's actually on the wire (osc-stream.js
      // sanitizes anything outside [A-Za-z0-9_-] with "_") so the readout
      // doubles as a copy-pasteable reference for Max [route ...] objects.
      const wireAddr = '/sensor/' + n.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
      host.appendChild(_el('div', {
        class: 'staging-stream-row',
        'data-stream-row': 'sensor',
        'data-sensor-name': n,
      }, [
        _el('span', { class: 'staging-stream-addr' }, wireAddr),
        _el('span', { class: 'staging-stream-vals', 'data-sensor-vals': n }, '—'),
      ]));
    }
    if (names.length === 0) {
      host.appendChild(_el('div', { class: 'staging-empty' },
        '(no sensors with calibrated data yet — waiting for quaternion frames)'));
    }
  }

  for (const n of names) {
    const cell = host.querySelector(`[data-sensor-vals="${CSS.escape(n)}"]`);
    if (!cell) continue;
    const v = sensors[n];
    cell.textContent =
      _fmtN(v[0], 1) + '  ' +
      _fmtN(v[1], 1) + '  ' +
      _fmtN(v[2], 1);
  }
}

// ── Posture map (3D identity viz) ───────────────────────────────────────────

function _buildMap() {
  const section = _el('div', { class: 'staging-section staging-map-section' });
  section.appendChild(_el('div', { class: 'staging-section-title-row' }, [
    _el('span', { class: 'staging-section-title' }, 'posture map'),
    _el('span', { class: 'staging-section-hint' },
      'click empty to drop · click dot to select · right-click to delete'),
  ]));
  // Actual 3D canvas lives inside this container; posture-map owns its sizing.
  const host = _el('div', { class: 'posture-map-host' });
  section.appendChild(host);
  _mapRoot = host;
  return section;
}

function _mountMapIfNeeded() {
  if (_mapMounted || !_mapRoot) return;
  initPostureMap(_mapRoot, {
    onSelect: (id) => {
      // Scroll the matching snapshot row into view and highlight it briefly.
      const row = _snapshotsRoot?.querySelector(`.staging-snap-row[data-id="${CSS.escape(id)}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        row.classList.add('staging-snap-row-flash');
        setTimeout(() => row.classList.remove('staging-snap-row-flash'), 900);
      }
    },
    onChanged: () => {
      // Map-driven capture / delete — resync the table and channel-dependent UI.
      _renderSnapshots();
    },
  });
  _mapMounted = true;
}

// ── Interpolation controls ──────────────────────────────────────────────────

function _buildInterp() {
  const root = _el('div', { class: 'staging-section' });
  _interpRoot = root;
  _renderInterp();
  return root;
}

function _renderInterp() {
  if (!_interpRoot) return;
  _clear(_interpRoot);
  const interp = (S.staging && S.staging.interpolation) || {};

  _interpRoot.appendChild(_el('div', { class: 'staging-section-title' }, 'interpolation'));

  const row = _el('div', { class: 'staging-row' });

  // Mode
  const modeSel = _el('select', { class: 'staging-sel' });
  for (const [v, lbl] of Object.entries(KERNEL_LABELS)) {
    const opt = _el('option', { value: v }, lbl);
    if ((interp.mode || 'gaussian') === v) opt.selected = true;
    modeSel.appendChild(opt);
  }
  modeSel.addEventListener('change', () => { setInterpolation({ mode: modeSel.value }); _renderInterp(); });
  row.appendChild(_el('label', { class: 'staging-lbl' }, ['mode', modeSel]));

  // Mode-specific
  if ((interp.mode || 'gaussian') === 'gaussian') {
    const sigmaSlider = _el('input', { type: 'range', min: '0.05', max: '1.5', step: '0.01', value: String(interp.sigma ?? 0.3), class: 'staging-slider' });
    const sigmaVal = _el('span', { class: 'staging-readout' }, _fmtN(interp.sigma ?? 0.3, 2));
    sigmaSlider.addEventListener('input', () => {
      const v = parseFloat(sigmaSlider.value);
      setInterpolation({ sigma: v });
      sigmaVal.textContent = _fmtN(v, 2);
    });
    row.appendChild(_el('label', { class: 'staging-lbl' }, ['σ', sigmaSlider, sigmaVal]));
  } else if (interp.mode === 'knearest') {
    const kIn = _el('input', { type: 'number', min: '1', max: '16', step: '1', value: String(interp.k ?? 3), class: 'staging-num' });
    kIn.addEventListener('change', () => setInterpolation({ k: Math.max(1, Math.min(16, parseInt(kIn.value, 10) || 3)) }));
    row.appendChild(_el('label', { class: 'staging-lbl' }, ['k', kIn]));
  } else if (interp.mode === 'idw') {
    const fIn = _el('input', { type: 'number', min: '0.5', max: '8', step: '0.1', value: String(interp.falloff ?? 2), class: 'staging-num' });
    fIn.addEventListener('change', () => setInterpolation({ falloff: parseFloat(fIn.value) || 2 }));
    row.appendChild(_el('label', { class: 'staging-lbl' }, ['falloff', fIn]));
  }

  _interpRoot.appendChild(row);

  // Axis weights
  const axisRow = _el('div', { class: 'staging-row' });
  axisRow.appendChild(_el('span', { class: 'staging-lbl-static' }, 'axis weight'));
  for (let i = 0; i < IDENTITY_AXES.length; i++) {
    const key = IDENTITY_KEYS[i];
    const lbl = IDENTITY_AXES[i];
    const val = (interp.axisWeights && interp.axisWeights[key]) ?? 1;
    const inp = _el('input', { type: 'number', min: '0', max: '4', step: '0.1', value: String(val), class: 'staging-num' });
    inp.addEventListener('change', () => setInterpolation({ axisWeights: { [key]: parseFloat(inp.value) || 0 } }));
    axisRow.appendChild(_el('label', { class: 'staging-lbl' }, [lbl, inp]));
  }
  _interpRoot.appendChild(axisRow);
}

// ── Channels ────────────────────────────────────────────────────────────────

function _buildChannels() {
  const root = _el('div', { class: 'staging-section' });
  _channelsRoot = root;
  _renderChannels();
  return root;
}

function _renderChannels() {
  if (!_channelsRoot) return;
  _clear(_channelsRoot);
  const preset = (S.staging && S.staging.mappingPreset) || { name: 'untitled', channels: [] };

  const header = _el('div', { class: 'staging-section-title-row' }, [
    _el('span', { class: 'staging-section-title' }, `channels (${preset.channels.length})`),
    _el('button', {
      class: 'staging-mini-btn',
      onclick: () => { addChannel(); _renderChannels(); _renderSnapshots(); },
    }, '+ add channel'),
  ]);
  _channelsRoot.appendChild(header);

  if (preset.channels.length === 0) {
    _channelsRoot.appendChild(_el('div', { class: 'staging-empty' },
      'no channels yet — add one to start routing output'));
    return;
  }

  for (const ch of preset.channels) {
    _channelsRoot.appendChild(_buildChannelRow(ch));
  }
}

function _buildChannelRow(ch) {
  const row = _el('div', { class: 'staging-ch-row', 'data-protocol': ch.protocol });

  // Protocol accent bar
  row.appendChild(_el('span', { class: `staging-ch-accent staging-ch-accent-${ch.protocol}` }));

  // Name
  const nameIn = _el('input', { type: 'text', value: ch.name, class: 'staging-ch-name', title: 'channel name — snapshots key values by this name' });
  nameIn.addEventListener('change', () => {
    const nn = nameIn.value.trim();
    if (!nn || nn === ch.name) { nameIn.value = ch.name; return; }
    if (!renameChannel(ch.name, nn)) { nameIn.value = ch.name; return; }
    _renderChannels(); _renderSnapshots();
  });
  row.appendChild(nameIn);

  // Protocol
  const protoSel = _el('select', { class: 'staging-sel' });
  for (const [v, lbl] of [['midi', 'MIDI'], ['osc', 'OSC']]) {
    const opt = _el('option', { value: v }, lbl);
    if (ch.protocol === v) opt.selected = true;
    protoSel.appendChild(opt);
  }
  protoSel.addEventListener('change', () => {
    ch.protocol = protoSel.value;
    saveStaging();
    _renderChannels();
  });
  row.appendChild(protoSel);

  // Per-protocol destination widgets
  if (ch.protocol === 'midi') {
    const devSel = _el('select', { class: 'staging-sel-dev', title: 'MIDI output device' });
    const outs = listMIDIOutputs();
    devSel.appendChild(_el('option', { value: '' }, '(no device)'));
    let present = false;
    for (const o of outs) {
      const opt = _el('option', { value: o.id }, o.name || o.id);
      if (ch.device === o.id) { opt.selected = true; present = true; }
      devSel.appendChild(opt);
    }
    if (ch.device && !present) {
      const opt = _el('option', { value: ch.device }, '(disconnected)');
      opt.selected = true;
      devSel.appendChild(opt);
    }
    devSel.addEventListener('change', () => { ch.device = devSel.value; saveStaging(); });
    row.appendChild(devSel);

    const chIn = _el('input', { type: 'number', min: '1', max: '16', step: '1', value: String(ch.ch || 1), class: 'staging-num-sm', title: 'MIDI channel 1–16' });
    chIn.addEventListener('change', () => { ch.ch = Math.max(1, Math.min(16, parseInt(chIn.value, 10) || 1)); saveStaging(); });
    row.appendChild(chIn);

    const ccIn = _el('input', { type: 'number', min: '0', max: '127', step: '1', value: String(ch.cc ?? 20), class: 'staging-num-sm', title: 'CC number' });
    ccIn.addEventListener('change', () => { ch.cc = Math.max(0, Math.min(127, parseInt(ccIn.value, 10) || 0)); saveStaging(); });
    row.appendChild(ccIn);

    const bitsSel = _el('select', { class: 'staging-sel-sm', title: 'CC resolution' });
    for (const v of [7, 14]) {
      const opt = _el('option', { value: String(v) }, v + '-bit');
      if ((ch.bits || 7) === v) opt.selected = true;
      bitsSel.appendChild(opt);
    }
    bitsSel.addEventListener('change', () => { ch.bits = parseInt(bitsSel.value, 10); saveStaging(); });
    row.appendChild(bitsSel);
  } else if (ch.protocol === 'osc') {
    const hostIn = _el('input', { type: 'text', value: ch.host || '127.0.0.1', class: 'staging-host', title: 'OSC host' });
    hostIn.addEventListener('change', () => { ch.host = hostIn.value.trim() || '127.0.0.1'; saveStaging(); });
    row.appendChild(hostIn);

    const portIn = _el('input', { type: 'number', min: '1', max: '65535', step: '1', value: String(ch.port || 9000), class: 'staging-num-sm', title: 'OSC port' });
    portIn.addEventListener('change', () => { ch.port = parseInt(portIn.value, 10) || 9000; saveStaging(); });
    row.appendChild(portIn);

    const addrIn = _el('input', { type: 'text', value: ch.address || '/' + ch.name, class: 'staging-addr', title: 'OSC address (starts with /)' });
    addrIn.addEventListener('change', () => {
      let a = addrIn.value.trim();
      if (!a.startsWith('/')) a = '/' + a;
      ch.address = a;
      addrIn.value = a;
      saveStaging();
    });
    row.appendChild(addrIn);
  }

  // Range min/max
  const minIn = _el('input', { type: 'number', step: '0.01', value: String(ch.min ?? 0), class: 'staging-num-sm', title: 'min output value' });
  minIn.addEventListener('change', () => { ch.min = parseFloat(minIn.value) || 0; saveStaging(); });
  row.appendChild(_el('label', { class: 'staging-lbl' }, ['min', minIn]));

  const maxIn = _el('input', { type: 'number', step: '0.01', value: String(ch.max ?? 1), class: 'staging-num-sm', title: 'max output value' });
  maxIn.addEventListener('change', () => { ch.max = parseFloat(maxIn.value) || 1; saveStaging(); });
  row.appendChild(_el('label', { class: 'staging-lbl' }, ['max', maxIn]));

  // Hold toggle
  const holdCb = _el('input', { type: 'checkbox' });
  holdCb.checked = !!ch.hold;
  holdCb.addEventListener('change', () => { ch.hold = holdCb.checked; saveStaging(); });
  row.appendChild(_el('label', { class: 'staging-lbl', title: 'hold — freezes emission on this channel for troubleshooting' }, ['hold', holdCb]));

  // Test button
  const testBtn = _el('button', { class: 'staging-mini-btn', title: 'send max value once to verify reception' }, 'test');
  testBtn.addEventListener('click', () => {
    let status = 'unavailable';
    if (ch.protocol === 'midi' && ch.device) {
      const maxVal = ch.bits === 14 ? 16383 : 127;
      status = midiTestSend(ch.device, ch.ch || 1, ch.cc ?? 0, maxVal, { bits: ch.bits || 7 });
    } else if (ch.protocol === 'osc' && ch.host && ch.port && ch.address) {
      status = oscTestSend(ch.host, ch.port, ch.address, [ch.max ?? 1]);
    }
    testBtn.style.color = TX_COLORS[status] || '#aaa';
    setTimeout(() => { testBtn.style.color = ''; }, 600);
  });
  row.appendChild(testBtn);

  // Live tx indicator
  const tx = _el('span', { class: 'staging-tx-dot' });
  tx.dataset.channel = ch.name;
  row.appendChild(tx);

  // Remove button
  const rm = _el('button', { class: 'staging-mini-btn staging-mini-btn-danger', title: 'remove channel' }, '×');
  rm.addEventListener('click', () => { removeChannel(ch.name); _renderChannels(); _renderSnapshots(); });
  row.appendChild(rm);

  return row;
}

// ── Snapshots ───────────────────────────────────────────────────────────────

function _buildSnapshots() {
  const root = _el('div', { class: 'staging-section' });
  _snapshotsRoot = root;
  _renderSnapshots();
  return root;
}

function _renderSnapshots() {
  if (!_snapshotsRoot) return;
  _clear(_snapshotsRoot);
  const snaps = (S.staging && S.staging.snapshots) || [];
  const channels = ((S.staging && S.staging.mappingPreset?.channels) || []);

  const hdr = _el('div', { class: 'staging-section-title-row' }, [
    _el('span', { class: 'staging-section-title' }, `snapshots (${snaps.length})`),
    _el('button', {
      class: 'staging-mini-btn',
      title: 'drop a snapshot at the current live identity',
      onclick: () => { captureSnapshot(); _renderSnapshots(); },
    }, '+ capture from live'),
  ]);
  _snapshotsRoot.appendChild(hdr);

  if (snaps.length === 0) {
    _snapshotsRoot.appendChild(_el('div', { class: 'staging-empty' },
      'no snapshots yet — hold a posture and press "capture from live"'));
    return;
  }

  // Header row
  const headRow = _el('div', { class: 'staging-snap-head' }, [
    _el('span', { class: 'staging-snap-hcell staging-snap-cell-weight' }, 'w'),
    _el('span', { class: 'staging-snap-hcell staging-snap-cell-label' }, 'label'),
    ...IDENTITY_AXES.map(a => _el('span', { class: 'staging-snap-hcell staging-snap-cell-id' }, a)),
    ...channels.map(c => _el('span', { class: 'staging-snap-hcell staging-snap-cell-val' }, c.name)),
    _el('span', { class: 'staging-snap-hcell' }, ''),
  ]);
  _snapshotsRoot.appendChild(headRow);

  for (const s of snaps) {
    _snapshotsRoot.appendChild(_buildSnapshotRow(s, channels));
  }
}

function _buildSnapshotRow(s, channels) {
  const row = _el('div', { class: 'staging-snap-row', 'data-id': s.id });

  // Weight bar (filled in on tick)
  const wCell = _el('span', { class: 'staging-snap-cell staging-snap-cell-weight', 'data-id': s.id }, [
    _el('span', { class: 'staging-weight-bar' }, [
      _el('span', { class: 'staging-weight-fill' }),
    ]),
    _el('span', { class: 'staging-weight-num' }, '—'),
  ]);
  row.appendChild(wCell);

  // Label
  const lblIn = _el('input', { type: 'text', value: s.label, class: 'staging-snap-label' });
  lblIn.addEventListener('change', () => updateSnapshotLabel(s.id, lblIn.value.trim() || s.label));
  row.appendChild(_el('span', { class: 'staging-snap-cell staging-snap-cell-label' }, lblIn));

  // Identity axes (read-only — captured from live; edit by re-capturing)
  for (let i = 0; i < IDENTITY_AXES.length; i++) {
    row.appendChild(_el('span', { class: 'staging-snap-cell staging-snap-cell-id' }, _fmtN(s.identity?.[i] ?? 0, 1)));
  }

  // Per-channel values
  for (const ch of channels) {
    const v = s.values?.[ch.name];
    const inp = _el('input', {
      type: 'number',
      step: '0.01',
      value: typeof v === 'number' ? String(v) : '',
      class: 'staging-snap-val',
      placeholder: '—',
    });
    inp.addEventListener('change', () => {
      const raw = inp.value.trim();
      if (raw === '') {
        // delete value — remove key
        if (s.values && ch.name in s.values) { delete s.values[ch.name]; saveStaging(); }
      } else {
        const f = parseFloat(raw);
        if (Number.isFinite(f)) updateSnapshotValue(s.id, ch.name, f);
      }
    });
    row.appendChild(_el('span', { class: 'staging-snap-cell staging-snap-cell-val' }, inp));
  }

  // Delete
  const rm = _el('button', { class: 'staging-mini-btn staging-mini-btn-danger', title: 'delete snapshot' }, '×');
  rm.addEventListener('click', () => { deleteSnapshot(s.id); _renderSnapshots(); });
  row.appendChild(_el('span', { class: 'staging-snap-cell' }, rm));

  return row;
}

// ── Mapping-preset library ──────────────────────────────────────────────────

function _buildLibrary() {
  const root = _el('div', { class: 'staging-section' });
  _libraryRoot = root;
  _renderLibrary();
  return root;
}

function _renderLibrary() {
  if (!_libraryRoot) return;
  _clear(_libraryRoot);
  const lib = (S.staging && S.staging.mappingPresetLibrary) || [];
  const current = (S.staging && S.staging.mappingPreset) || { name: 'untitled' };

  _libraryRoot.appendChild(_el('div', { class: 'staging-section-title' }, 'mapping preset'));

  const row = _el('div', { class: 'staging-row' });

  const nameIn = _el('input', { type: 'text', value: current.name || 'untitled', class: 'staging-preset-name' });
  nameIn.addEventListener('change', () => { current.name = nameIn.value.trim() || 'untitled'; saveStaging(); });
  row.appendChild(_el('label', { class: 'staging-lbl' }, ['name', nameIn]));

  const saveBtn = _el('button', { class: 'staging-mini-btn', onclick: () => {
    saveMappingPresetToLibrary(nameIn.value.trim() || 'untitled');
    _renderLibrary();
  } }, 'save preset');
  row.appendChild(saveBtn);

  // Library dropdown
  const libSel = _el('select', { class: 'staging-sel' });
  libSel.appendChild(_el('option', { value: '' }, `— load preset (${lib.length}) —`));
  for (const p of lib) libSel.appendChild(_el('option', { value: p.name }, p.name));
  libSel.addEventListener('change', () => {
    const name = libSel.value;
    if (!name) return;
    loadMappingPresetFromLibrary(name);
    _renderChannels(); _renderSnapshots(); _renderLibrary();
  });
  row.appendChild(libSel);

  // Delete-preset button (operates on current name if in library)
  const inLib = lib.some(p => p.name === current.name);
  if (inLib) {
    const delBtn = _el('button', { class: 'staging-mini-btn staging-mini-btn-danger' }, 'delete');
    delBtn.addEventListener('click', () => {
      deleteMappingPresetFromLibrary(current.name);
      _renderLibrary();
    });
    row.appendChild(delBtn);
  }

  _libraryRoot.appendChild(row);
}

// ── Live readouts ───────────────────────────────────────────────────────────

function _buildReadouts() {
  const root = _el('div', { class: 'staging-section staging-readouts' });
  _readoutsRoot = root;
  _renderReadouts();
  return root;
}

function _renderReadouts() {
  if (!_readoutsRoot) return;
  _clear(_readoutsRoot);

  _readoutsRoot.appendChild(_el('div', { class: 'staging-section-title' }, 'live readouts'));

  // Identity vector display
  const idRow = _el('div', { class: 'staging-row' });
  idRow.appendChild(_el('span', { class: 'staging-lbl-static' }, 'identity'));
  for (let i = 0; i < IDENTITY_AXES.length; i++) {
    const span = _el('span', { class: 'staging-readout-box' }, [
      _el('span', { class: 'staging-readout-lbl' }, IDENTITY_AXES[i]),
      _el('span', { class: 'staging-readout-val', 'data-id-axis': String(i) }, '—'),
    ]);
    idRow.appendChild(span);
  }
  const frameDot = _el('span', { class: 'staging-readout-box', id: 'stagingFrameDot' }, [
    _el('span', { class: 'staging-readout-lbl' }, 'frame'),
    _el('span', { class: 'staging-readout-val', id: 'stagingFrameState' }, '—'),
  ]);
  idRow.appendChild(frameDot);
  _readoutsRoot.appendChild(idRow);

  // Per-channel output lines
  const chans = (S.staging && S.staging.mappingPreset?.channels) || [];
  if (chans.length === 0) {
    _readoutsRoot.appendChild(_el('div', { class: 'staging-empty' }, 'no channels — add some to see output'));
  } else {
    const grid = _el('div', { class: 'staging-ch-readout-grid' });
    for (const c of chans) {
      grid.appendChild(_el('div', { class: 'staging-ch-readout', 'data-channel': c.name }, [
        _el('span', { class: 'staging-ch-readout-name' }, c.name),
        _el('span', { class: 'staging-ch-readout-pre', 'data-readout': 'pre' }, '—'),
        _el('span', { class: 'staging-ch-readout-wire', 'data-readout': 'wire' }, '—'),
        _el('span', { class: 'staging-ch-readout-status', 'data-readout': 'status' }, '—'),
      ]));
    }
    _readoutsRoot.appendChild(grid);
  }

  // Weight-sum indicator
  _readoutsRoot.appendChild(_el('div', { class: 'staging-row' }, [
    _el('span', { class: 'staging-lbl-static' }, 'weight sum'),
    _el('span', { id: 'stagingWeightSum', class: 'staging-readout' }, '—'),
    _el('span', { class: 'staging-lbl-static' }, 'tick'),
    _el('span', { id: 'stagingTickCount', class: 'staging-readout' }, '0'),
    _el('span', { class: 'staging-lbl-static' }, 'emit'),
    _el('span', { id: 'stagingEmitCount', class: 'staging-readout' }, '0'),
  ]));
}

// Update readouts + per-snapshot weight bars without tearing them down.
// Called from S._onStagingTick.
function _updateLiveReadouts() {
  if (!_isOpen) return;
  if (!S.staging) return;
  const tel = S.staging.telemetry;
  if (!tel) return;

  // Identity
  const id = tel.identityRaw || [];
  for (let i = 0; i < IDENTITY_AXES.length; i++) {
    const el = _readoutsRoot?.querySelector(`[data-id-axis="${i}"]`);
    if (el) el.textContent = _fmtN(id[i] ?? 0, 1) + '°';
  }

  const frameSt = document.getElementById('stagingFrameState');
  if (frameSt) {
    const rel = S.staging.relational;
    frameSt.textContent = rel?.hasFrame ? 'paired' : rel?.hasCursor ? 'cursor only' : 'none';
    frameSt.style.color = rel?.hasFrame ? '#81c784' : rel?.hasCursor ? '#ffb74d' : '#e57373';
  }

  // Weights
  const weights = tel.weights || [];
  let wsum = 0;
  for (const w of weights) wsum += w;
  const wsumEl = document.getElementById('stagingWeightSum');
  if (wsumEl) wsumEl.textContent = _fmtN(wsum, 2);
  const tcEl = document.getElementById('stagingTickCount');
  if (tcEl) tcEl.textContent = String(tel.tickCount || 0);
  const emEl = document.getElementById('stagingEmitCount');
  if (emEl) emEl.textContent = String(tel.totalEmit || 0);

  // Per-snapshot weight bars
  const snaps = S.staging.snapshots || [];
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const w = weights[i] ?? 0;
    const cell = _snapshotsRoot?.querySelector(`.staging-snap-cell-weight[data-id="${s.id}"]`);
    if (cell) {
      const fill = cell.querySelector('.staging-weight-fill');
      const num  = cell.querySelector('.staging-weight-num');
      if (fill) fill.style.width = Math.max(0, Math.min(100, w * 100)) + '%';
      if (num) num.textContent = _fmtN(w, 2);
    }
  }

  // Per-channel output readouts
  const perCh = tel.perChannel || {};
  const grid = _readoutsRoot?.querySelector('.staging-ch-readout-grid');
  if (grid) {
    for (const [name, d] of Object.entries(perCh)) {
      const row = grid.querySelector(`[data-channel="${CSS.escape(name)}"]`);
      if (!row) continue;
      const pre = row.querySelector('[data-readout="pre"]');
      const wire = row.querySelector('[data-readout="wire"]');
      const status = row.querySelector('[data-readout="status"]');
      if (pre) pre.textContent = _fmtN(d.pre, 3);
      if (wire) wire.textContent = d.wire === null || d.wire === undefined ? '—' : (typeof d.wire === 'number' && !Number.isInteger(d.wire) ? _fmtN(d.wire, 3) : String(d.wire));
      if (status) { status.textContent = d.status; status.style.color = TX_COLORS[d.status] || '#aaa'; }
    }
  }

  // Channel tx dots
  const chansRoot = _channelsRoot;
  if (chansRoot) {
    const dots = chansRoot.querySelectorAll('.staging-tx-dot');
    for (const dot of dots) {
      const name = dot.dataset.channel;
      const d = perCh[name];
      if (!d) { dot.style.background = TX_COLORS.idle; continue; }
      dot.style.background = TX_COLORS[d.status] || TX_COLORS.idle;
    }
  }
}

// ── Top-level render ────────────────────────────────────────────────────────

function _renderAll() {
  _renderBanner();
  _renderStreamOut();
  _renderInterp();
  _renderChannels();
  _renderSnapshots();
  _renderLibrary();
  _renderReadouts();
}

function _buildBody() {
  const root = _el('div', { class: 'staging-body' });
  root.appendChild(_buildBanner());
  root.appendChild(_buildStreamOut());
  root.appendChild(_buildMap());
  root.appendChild(_buildInterp());
  root.appendChild(_buildLibrary());
  root.appendChild(_buildChannels());
  root.appendChild(_buildSnapshots());
  root.appendChild(_buildReadouts());
  return root;
}

// ── Modal open/close ────────────────────────────────────────────────────────

export function openStagingModal() {
  if (!_modal) return;
  _isOpen = true;
  _modal.classList.add('open');
  _renderAll();
  // Mount on first open — needs the container laid out in the DOM so the
  // initial ResizeObserver pass picks up a non-zero size.
  _mountMapIfNeeded();
  pokePostureMap();
}

export function closeStagingModal() {
  if (!_modal) return;
  _isOpen = false;
  _modal.classList.remove('open');
  clearPostureSelection();
}

export function initStagingUI() {
  _modal = document.getElementById('stagingModal');
  if (!_modal) return;

  const closeBtn = document.getElementById('stagingClose');
  const btn      = document.getElementById('stagingBtn');

  // Fill in dialog body (only once — this function is called on init).
  const body = _modal.querySelector('.staging-dialog-body');
  if (body) {
    _clear(body);
    _bodyRoot = _buildBody();
    body.appendChild(_bodyRoot);
  }

  btn?.addEventListener('click', () => { openStagingModal(); });
  closeBtn?.addEventListener('click', closeStagingModal);
  _modal.addEventListener('click', (e) => { if (e.target === _modal) closeStagingModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _isOpen) closeStagingModal();
  });

  // Re-render channel device dropdowns on MIDI device connect/disconnect.
  onMIDIStateChange(() => { if (_isOpen) { _renderBanner(); _renderChannels(); } });

  // Subscribe to engine ticks for live readouts.
  S._onStagingTick = () => _updateLiveReadouts();
  // Stream-out has its own tick hook — kept separate so the stream UI updates
  // even when the snapshot engine is stopped.
  S._onOSCStreamTick = () => _updateStreamReadouts();
}
