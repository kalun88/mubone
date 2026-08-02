// ============================================================================
// ui-accessory.js — accessory channel table
//
// One row per pad on the x-IMU3 serial accessory (SA-A8: 8 analogue inputs).
// Each row picks a type (pot / slider / button) and a destination action, and
// shows the live value so you can tell at a glance which pad is which control.
//
// The min/max/γ columns are the scale stage (see scale.js): where the two ends
// of the pot's travel land, and how the travel is distributed between them.
// min/max are edited in the DESTINATION's units — cents for pitch, Hz for a
// filter — and converted to the normalised 0–1 the registry stores.
//
// Rows are built once and mutated in place.  The live loop only runs while the
// modal is open and is capped well below frame rate — this table sits on the
// same thread as the grain scheduler, and 8 rows of per-frame DOM writes is
// exactly the kind of thing CLAUDE.md warns about.
// ============================================================================

import { S } from './state.js';
import {
  ROLES, getChannels, isReceiving, getRateHz, getSerialMode, isAccessoryModeSet,
  setAccessoryMode, setRole, setAction, setOption, armCalibration, endCalibration,
  resetScale, onAccessoryPresenceChange,
} from './accessory-registry.js';
import { toNorm, fromNorm, clampReal, fmtNumber, rangeMin, rangeMax } from './scale.js';

const LIVE_INTERVAL_MS = 50;   // 20 Hz — plenty for reading a moving value

// The destination's range descriptor, or null if the channel is unbound or the
// action predates the annotation.  Read through S._actions rather than importing
// midi.js — same circular-import dodge the registry uses.
function rangeFor(ch) {
  if (!ch?.actionId) return null;
  return (S._actions || []).find(a => a.id === ch.actionId)?.range ?? null;
}

// Scale cells only make sense for a continuous channel pointed at something.
function scaleEditable(ch) {
  return (ch.role === 'pot' || ch.role === 'slider') && !!rangeFor(ch);
}

let _modal   = null;
let _body    = null;
let _rows    = [];             // per-pad cached element refs
let _rafId   = null;
let _lastAt  = 0;
let _learningPad = null;       // pad currently mid-calibration, or null

// ── Row construction ────────────────────────────────────────────────────────

function buildRow(ch) {
  const pad = ch.idx + 1;
  const tr  = document.createElement('tr');

  const tdPad = document.createElement('td');
  tdPad.className = 'acc-pad';
  tdPad.textContent = String(pad);

  const tdVolts = document.createElement('td');
  tdVolts.className = 'acc-volts';

  const tdValue = document.createElement('td');
  tdValue.className = 'acc-value';
  const bar  = document.createElement('div');
  bar.className = 'acc-bar';
  const fill = document.createElement('div');
  fill.className = 'acc-bar-fill';
  bar.appendChild(fill);
  tdValue.appendChild(bar);

  // ── type ──
  const tdRole = document.createElement('td');
  const roleSel = document.createElement('select');
  roleSel.className = 'acc-select';
  for (const r of ROLES) {
    const o = document.createElement('option');
    o.value = r; o.textContent = r;
    roleSel.appendChild(o);
  }
  roleSel.value = ch.role;
  tdRole.appendChild(roleSel);

  // ── destination ──
  const tdDest = document.createElement('td');
  const destSel = document.createElement('select');
  destSel.className = 'acc-select acc-dest';
  tdDest.appendChild(destSel);

  const tdRange = document.createElement('td');
  tdRange.className = 'acc-range';

  // ── scale: output window + response curve ──
  // Three numboxes rather than one packed field: these get nudged mid-session
  // and a combined "0.2–0.8 γ1.4" cell would mean retyping all three to change
  // one.  min/max are shown in the DESTINATION's units (cents, Hz, ms) and
  // converted to the stored 0–1 on the way in.
  const tdMin = document.createElement('td');
  const minBox = document.createElement('input');
  minBox.type = 'text';
  minBox.className = 'acc-num';
  tdMin.appendChild(minBox);

  const tdMax = document.createElement('td');
  const maxBox = document.createElement('input');
  maxBox.type = 'text';
  maxBox.className = 'acc-num';
  tdMax.appendChild(maxBox);

  const tdCurve = document.createElement('td');
  const curveBox = document.createElement('input');
  curveBox.type = 'text';
  curveBox.className = 'acc-num acc-num--curve';
  curveBox.title = 'response exponent — 1 linear, >1 fine at the bottom of the throw, <1 fine at the top. Double-click to reset the whole scale stage.';
  tdCurve.appendChild(curveBox);

  // ── calibrate ──
  const tdCal = document.createElement('td');
  const calBtn = document.createElement('button');
  calBtn.className = 'learn-btn';
  calBtn.textContent = 'calibrate';
  tdCal.appendChild(calBtn);

  // ── invert ──
  const tdInv = document.createElement('td');
  const invBox = document.createElement('input');
  invBox.type = 'checkbox';
  invBox.checked = !!ch.invert;
  tdInv.appendChild(invBox);

  tr.append(tdPad, tdVolts, tdValue, tdRole, tdDest, tdRange, tdMin, tdMax, tdCurve, tdCal, tdInv);

  // ── behaviour ──
  roleSel.addEventListener('change', () => {
    setRole(pad, roleSel.value);
    populateDest(pad, destSel, roleSel.value);
    syncRowChrome(pad);
  });

  destSel.addEventListener('change', () => {
    setAction(pad, destSel.value || null);
    // The bounds are stored normalised, so retargeting keeps the same fraction
    // of travel — but the units they're displayed in have just changed.
    syncRowChrome(pad);
  });

  // Commit on Enter or blur, not on every keystroke: typing "-600" would
  // otherwise apply "-", "-6", "-60" on the way through and move the pot's
  // window three times mid-edit.
  const commitBound = (box, key) => {
    const apply = () => {
      const ch = getChannels()[pad - 1];
      const range = rangeFor(ch);
      if (!range) return;
      const typed = parseFloat(String(box.value).replace(/[^\d.+-]/g, ''));
      if (Number.isFinite(typed)) setOption(pad, key, toNorm(range, clampReal(range, typed)));
      syncRowChrome(pad);
    };
    box.addEventListener('blur', apply);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); box.blur(); }
      if (e.key === 'Escape') { syncRowChrome(pad); box.blur(); }
    });
  };
  commitBound(minBox, 'outLo');
  commitBound(maxBox, 'outHi');

  const applyCurveBox = () => {
    const typed = parseFloat(String(curveBox.value).replace(/[^\d.]/g, ''));
    if (Number.isFinite(typed)) setOption(pad, 'curve', typed);
    syncRowChrome(pad);
  };
  curveBox.addEventListener('blur', applyCurveBox);
  curveBox.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); curveBox.blur(); }
    if (e.key === 'Escape') { syncRowChrome(pad); curveBox.blur(); }
  });
  curveBox.addEventListener('dblclick', () => { resetScale(pad); syncRowChrome(pad); });

  calBtn.addEventListener('click', () => {
    if (_learningPad === pad) {
      endCalibration(pad);
      _learningPad = null;
    } else {
      // Only one calibration at a time — otherwise a forgotten armed channel
      // keeps widening its range every time you brush past it.
      if (_learningPad !== null) endCalibration(_learningPad);
      armCalibration(pad);
      _learningPad = pad;
    }
    renderAll();
  });

  invBox.addEventListener('change', () => setOption(pad, 'invert', invBox.checked));

  _rows[ch.idx] = { tr, tdVolts, fill, roleSel, destSel, tdRange, minBox, maxBox, curveBox, calBtn, invBox };
  return tr;
}

// Destination options for a given role.  Buttons see bang/hold actions, pots
// and sliders see value actions — the filtering lives in the registry so the
// console and the table can't disagree about what's legal.
function populateDest(pad, sel, role) {
  const ch = getChannels()[pad - 1];
  sel.innerHTML = '';

  const none = document.createElement('option');
  none.value = ''; none.textContent = '—';
  sel.appendChild(none);

  if (role === 'unused') {
    sel.disabled = true;
    sel.value = '';
    return;
  }
  sel.disabled = false;

  const actions = (S._actions || []).filter(a =>
    a.id && (role === 'button' ? (a.type === 'trigger' || a.type === 'hold') : a.type === 'cc')
  );
  for (const a of actions) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.label || a.id;
    o.title = a.osc || '';
    sel.appendChild(o);
  }

  // A destination saved under a different type stays in the config but can't be
  // shown here — surface that rather than silently resetting it to none.
  if (ch.actionId && !actions.some(a => a.id === ch.actionId)) {
    const o = document.createElement('option');
    o.value = ch.actionId;
    o.textContent = `${ch.actionId} (wrong type)`;
    sel.appendChild(o);
  }
  sel.value = ch.actionId || '';
}

// ── Per-row chrome that only changes on user action, not per frame ──────────

function syncRowChrome(pad) {
  const ch  = getChannels()[pad - 1];
  const row = _rows[pad - 1];
  if (!ch || !row) return;

  row.tr.classList.toggle('acc-unused', ch.role === 'unused');
  row.tdRange.textContent = (ch.role === 'unused' || ch.role === 'button')
    ? '—'
    : `${ch.cal.min.toFixed(2)}–${ch.cal.max.toFixed(2)} V`;

  const learning = _learningPad === pad;
  row.calBtn.classList.toggle('learning', learning);
  row.calBtn.textContent = learning ? 'sweep… click to finish' : 'calibrate';
  row.calBtn.disabled = (ch.role === 'unused' || ch.role === 'button');
  row.invBox.disabled = (ch.role === 'unused');

  syncScaleCells(ch, row);
}

// Scale cells show the destination's units, so they have to be rebuilt whenever
// the destination changes — not just when the numbers do.
function syncScaleCells(ch, row) {
  const range = rangeFor(ch);
  const on    = scaleEditable(ch);

  for (const box of [row.minBox, row.maxBox, row.curveBox]) {
    box.disabled = !on;
    box.classList.toggle('acc-num--off', !on);
  }

  if (!on) {
    // A button has no throw to shape; an unbound pot has no units to show one in.
    const why = (ch.role === 'button' || ch.role === 'unused') ? '—'
              : (ch.actionId ? '—' : 'pick a destination');
    row.minBox.value = row.maxBox.value = '';
    row.minBox.placeholder = row.maxBox.placeholder = why;
    row.curveBox.value = '';
    row.curveBox.placeholder = '—';
    return;
  }

  // Never write over a box being typed in: syncRowChrome also runs on the live
  // tick while a channel is calibrating, which would eat the edit mid-keystroke.
  const unit = range.unit ? ` ${range.unit}` : '';
  const set = (box, text) => { if (document.activeElement !== box) box.value = text; };
  set(row.minBox, fmtNumber(fromNorm(range, ch.outLo), !!range.int) + unit);
  set(row.maxBox, fmtNumber(fromNorm(range, ch.outHi), !!range.int) + unit);
  set(row.curveBox, fmtNumber(ch.curve));

  const full = `${fmtNumber(rangeMin(range), !!range.int)}–${fmtNumber(rangeMax(range), !!range.int)}${unit}`;
  row.minBox.title = row.maxBox.title = `full travel of this destination: ${full}`;

  // A window narrower than the full span is the whole point of the feature, but
  // it's also invisible once you've scrolled away — flag the row so you can see
  // at a glance which pots are limited.
  const limited = ch.outLo > 0.001 || ch.outHi < 0.999 || Math.abs(ch.curve - 1) > 0.001;
  row.tr.classList.toggle('acc-scaled', limited);
}

export function renderAll() {
  if (!_body) return;
  const chans = getChannels();
  if (!chans.length) return;

  if (!_rows.length || _rows.length !== chans.length) {
    _body.innerHTML = '';
    _rows = [];
    for (const ch of chans) _body.appendChild(buildRow(ch));
  }
  for (const ch of chans) {
    const pad = ch.idx + 1;
    const row = _rows[ch.idx];
    row.roleSel.value = ch.role;
    row.invBox.checked = !!ch.invert;
    populateDest(pad, row.destSel, ch.role);
    syncRowChrome(pad);   // also refreshes the scale cells
  }
  updateStatus();
}

// ── Live values ─────────────────────────────────────────────────────────────

function updateStatus() {
  const pill = document.getElementById('accStatusPill');
  const meta = document.getElementById('accStatusMeta');
  const btn  = document.getElementById('accModeBtn');
  if (!pill) return;

  const live = isReceiving();
  pill.textContent = live ? 'live' : 'no accessory';
  pill.classList.toggle('live', live);

  const mode = getSerialMode();
  meta.textContent = live
    ? `${getRateHz()} Hz`
    : (mode === null ? 'sensor not connected' : 'plug in the accessory');

  // Rescue hatch only — the x-IMU3 GUI can't run alongside mubone, so this is
  // the only way to fix a device knocked off Accessory mode.  Hidden when the
  // mode is already right, or when we haven't read it back yet.
  const needsMode = mode !== null && !isAccessoryModeSet();
  btn.hidden = !needsMode;
}

function liveTick(ts) {
  _rafId = requestAnimationFrame(liveTick);
  if (ts - _lastAt < LIVE_INTERVAL_MS) return;
  _lastAt = ts;

  const chans = getChannels();
  for (const ch of chans) {
    const row = _rows[ch.idx];
    if (!row) continue;
    row.tdVolts.textContent = ch.raw.toFixed(3);
    if (ch.role === 'unused') {
      row.fill.style.width = '0%';
      continue;
    }
    row.fill.style.width = (ch.value * 100).toFixed(1) + '%';
    row.fill.classList.toggle('on', ch.role === 'button' && ch.state === 1);
  }

  // Calibration widens the stored range as you sweep — show it moving so you
  // can see the sweep is registering before committing to it.
  if (_learningPad !== null) syncRowChrome(_learningPad);
  updateStatus();
}

function startLive() {
  if (_rafId === null) { _lastAt = 0; _rafId = requestAnimationFrame(liveTick); }
}

function stopLive() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}

// ── Footer button state ─────────────────────────────────────────────────────
// The A8 is passive — there is no on/off, only plugged in or not — so the
// button reports presence rather than offering a toggle. Same vocabulary as
// the LED feedback button beside it: hollow bullet + dim when nothing is
// arriving, solid bullet + white when data is flowing.
function _refreshBtnUI(live) {
  const btn = document.getElementById('accessoryBtn');
  if (!btn) return;
  btn.classList.toggle('active', !!live);
  btn.textContent = live ? '● accessory' : '○ accessory';
  btn.title = live
    ? 'accessory — x-IMU3 serial accessory (SA-A8) connected, data flowing. click for the channel table.'
    : 'accessory — x-IMU3 serial accessory (SA-A8): 8 analogue channels, pots / sliders / buttons.\nnothing arriving — plug it into the sensor.';
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initAccessoryUI() {
  const btn   = document.getElementById('accessoryBtn');
  _modal      = document.getElementById('accessoryModal');
  const close = document.getElementById('accessoryClose');
  _body       = document.getElementById('accessoryTableBody');
  const modeBtn = document.getElementById('accModeBtn');
  if (!btn || !_modal || !_body) return;

  const open = () => {
    _modal.classList.add('open');
    renderAll();
    startLive();
  };
  const shut = () => {
    _modal.classList.remove('open');
    stopLive();
    // Leaving a channel armed would keep widening its range unseen.
    if (_learningPad !== null) { endCalibration(_learningPad); _learningPad = null; }
  };

  btn.addEventListener('click', () => {
    _modal.classList.contains('open') ? shut() : open();
  });
  close?.addEventListener('click', shut);
  modeBtn?.addEventListener('click', () => {
    setAccessoryMode(true);
    // The read-back is asynchronous; give the device a moment before re-checking.
    setTimeout(updateStatus, 400);
  });

  onAccessoryPresenceChange(_refreshBtnUI);
  _refreshBtnUI(isReceiving());

  S.openAccessoryModal  = open;
  S.closeAccessoryModal = shut;
}
