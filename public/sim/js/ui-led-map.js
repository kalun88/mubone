// ============================================================================
// UI — x-IMU3 LED MAPPING MODAL
//
// Presentation layer for `ximu-led-feedback.js`. Same split as
// ui-accessory.js / accessory-registry.js: the engine owns state, persistence
// and the wire; this file only renders the table and writes edits back through
// setLedEntry().
//
// Table is built once on init (the row set is static) and re-synced on open —
// no live tick, unlike the accessory modal, because nothing here changes
// except in response to the user's own clicks.
// ============================================================================

import { S } from './state.js';
import {
  LED_STATES, LED_EVENTS, LED_PATTERNS, LED_PALETTE,
  getLedMap, setLedEntry, resetLedMap, patternRate, patternsFor,
  isXimuLedEnabled, setXimuLedEnabled, onLedEnabledChange,
  hasCursorDevice, testLedEntry,
  getActiveStateId, getLastEvent, currentTimbreColour, timbreStatus,
} from './ximu-led-feedback.js';

let _modal = null;
let _rows  = new Map();   // id → { el, kind, colour, swatches, patSel, countSel, rateCell, testBtn, onChk, nameCell }

// Live readout — runs only while the modal is open. 10 Hz is well below frame
// rate and reads no hardware; it just mirrors two engine getters.
let _liveTimer   = null;
let _lastEventAt = 0;
const LIVE_MS    = 100;

// ── When each row fires ────────────────────────────────────────────────────
// The engine's tables carry a `tip` written for a tooltip — several sentences
// of priority reasoning. A row needs one line saying WHEN it happens, read at a
// glance while scanning the column, so the short form lives here with the other
// presentation copy and the long form stays where it is.
// One LINE each, not one sentence: the column is 246px at 13px, so anything
// past about forty characters wraps and the row grows past the table's height.
// The long form is still the row's tooltip.
const WHEN = {
  idle:         'Nothing is happening.',
  scan:         'The cursor is granulating.',
  mute:         'The master output is muted.',
  erase:        'The erase brush is down.',
  trace:        'Manual trace is armed.',
  trace_hf:     'Armed, with the gate still closed.',
  trace_hf_rec: 'The gate is open — capturing now.',
  commit:       'A seed is planted.',
  release:      'A hold is picked up.',
  undo:         'An undo lands.',
  full:         'A commit is refused — slots full.',
  identify:     'On connect, and on a role switch.',
  mute_toggle:  'Mute is switched on or off.',
  tare:         'The cursor is tared.',
  patch:        'A patch changes.',
  sweep:        'A sweep runs.',
  erase_all:    'Everything is erased.',
  scan_toggle:  'Scan is switched on or off.',
  snapshot:     'A snapshot is captured.',
  trigger:      'A trigger buffer launches.',
};

// Is this page on screen? It has two hosts and only one of them is the modal:
// the settings shell MOVES this dialog into #settingsHost and takes the
// overlay's `.open` back off, so a refresh gated on that class stops running
// exactly while the page is in front of you (the same fault as #293's).
function _visible() {
  return !!_modal?.classList.contains('open')
      || !!document.querySelector('.settings-host .led-dialog');
}

// ── Row construction ───────────────────────────────────────────────────────

// One open colour menu at a time, and a click anywhere else shuts it.
let _openMenu = null;
function _closeMenus() { if (_openMenu) { _openMenu.hidden = true; _openMenu = null; } }
document.addEventListener('click', _closeMenus);

// Colour is a MENU (SETTINGS-GUI § 3), not a strip of twelve swatches: the
// column is 150px and the answer is one colour, so the cell states the current
// one and the palette opens over it. The returned array is still the palette
// buttons, keyed by data-hex, so _syncRow's selection and disabling are
// unchanged.
function _buildColour(id, cell) {
  cell.classList.add('led-colour');
  const trigger = document.createElement('button');
  trigger.className = 'set-btn set-btn--sm led-colour-trigger';
  const tSwatch = document.createElement('span');
  tSwatch.className = 'led-swatch';
  const tName = document.createElement('span');
  tName.className = 'led-colour-name';
  trigger.append(tSwatch, tName);

  const menu = document.createElement('div');
  menu.className = 'set-menu';
  menu.hidden = true;

  const items = [];
  for (const { hex, name } of LED_PALETTE) {
    const b = document.createElement('button');
    b.className = 'set-menu-item';
    b.dataset.hex = hex;
    const sw = document.createElement('span');
    sw.className = 'led-swatch';
    sw.style.background = hex;
    if (hex === '#000000') sw.classList.add('is-off');
    const nm = document.createElement('span');
    nm.textContent = name;
    b.append(sw, nm);
    b.addEventListener('click', e => {
      e.stopPropagation();
      setLedEntry(id, { colour: hex });
      _closeMenus();
      _syncRow(id);
    });
    menu.appendChild(b);
    items.push(b);
  }
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = _openMenu === menu;
    _closeMenus();
    if (!wasOpen) { menu.hidden = false; _openMenu = menu; }
  });

  cell.append(trigger, menu);
  return { trigger, tSwatch, tName, items };
}

function _buildPatternSelect(id, kind, cell) {
  const sel = document.createElement('select');
  sel.className = 'acc-select led-select';
  // patternsFor() applies the per-row restriction, so `timbre` only ever
  // appears on the scan row rather than on every state.
  for (const [key, p] of patternsFor(id, kind)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = p.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    setLedEntry(id, { pattern: sel.value });
    _syncRow(id);
  });
  cell.appendChild(sel);
  return sel;
}

function _buildCountSelect(id, cell) {
  const sel = document.createElement('select');
  // --sm because the column is 74px: the kit's dropdown is a fixed 190 and
  // would run straight through Test.
  sel.className = 'acc-select led-select led-count set-select--sm';
  for (let n = 1; n <= 5; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `${n}×`;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    setLedEntry(id, { count: parseInt(sel.value, 10) });
    _syncRow(id);
  });
  cell.appendChild(sel);
  return sel;
}

function _cell(cls) {
  const d = document.createElement('span');
  if (cls) d.className = cls;
  return d;
}

function _buildRow(row, kind) {
  const el = document.createElement('div');
  el.className = `set-table-row led-row led-row-${kind}`;

  // on — a toggle, because it is a boolean that stays
  const cOn = _cell('set-table-act');
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.className = 'set-toggle';
  chk.addEventListener('change', () => {
    setLedEntry(row.id, { enabled: chk.checked });
    _syncRow(row.id);
  });
  cOn.appendChild(chk);

  // function — name, and one line saying when it fires
  const cFn = _cell('led-fn');
  const name = _cell('led-fn-name');
  name.textContent = row.label;
  // The sub-line is a ROW, not a third line: the scan row hangs its live timbre
  // chip and status off the end of it, and stacking those made that one row
  // half again as tall as every other.
  const sub  = _cell('led-fn-sub');
  const when = _cell('led-fn-when');
  when.textContent = WHEN[row.id] || '';
  sub.appendChild(when);
  cFn.append(name, sub);
  if (row.tip) cFn.title = row.tip;

  const cColour = _cell();
  const cPat    = _cell();
  const cRate   = _cell(kind === 'event' ? 'led-count-cell' : 'set-table-num');
  cRate.classList.add('led-rate');
  const cTest   = _cell('set-table-act');

  const test = document.createElement('button');
  test.className = 'set-btn set-btn--sm led-test';
  test.textContent = '▸ test';
  test.addEventListener('click', () => testLedEntry(row.id));
  cTest.appendChild(test);

  el.append(cOn, cFn, cColour, cPat, cRate, cTest);

  const colour   = _buildColour(row.id, cColour);
  const patSel   = _buildPatternSelect(row.id, kind, cPat);
  const countSel = kind === 'event' ? _buildCountSelect(row.id, cRate) : null;
  // The burst's cost is a fact, so it is on screen and not in a tooltip: a
  // 13px sub-line under the count, event rows only.
  let burst = null;
  if (kind === 'event') {
    burst = _cell('set-table-sub');
    cRate.appendChild(burst);
  }

  _rows.set(row.id, {
    el, kind, colour, swatches: colour.items, patSel, countSel,
    rateCell: cRate, burst, testBtn: test, onChk: chk, nameCell: name, subCell: sub,
  });
  return el;
}

function _tableHead(rateLabel) {
  const head = document.createElement('div');
  head.className = 'set-table-head';
  for (const t of ['On', 'Function', 'Colour', 'Pattern', rateLabel, 'Test']) {
    const s = document.createElement('span');
    s.textContent = t;
    head.appendChild(s);
  }
  return head;
}

// ── Sync ───────────────────────────────────────────────────────────────────

function _syncRow(id) {
  const r   = _rows.get(id);
  const cfg = getLedMap()[id];
  if (!r || !cfg) return;

  r.onChk.checked = cfg.enabled;
  r.el.classList.toggle('is-off', !cfg.enabled);

  // Timbre takes its colour from the audio, so the swatch doesn't apply. The
  // cell still shows what is remembered, disabled, so switching back to solid
  // does not look like a fresh choice.
  // Only the pure timbre pattern ignores the swatch. The interleaves alternate
  // *against* the swatch colour, so it still matters there.
  const isTimbre = cfg.pattern === 'timbre';
  r.el.classList.toggle('is-timbre', isTimbre);

  const swatch = LED_PALETTE.find(p => p.hex === cfg.colour);
  r.colour.tSwatch.style.background = cfg.colour;
  r.colour.tSwatch.classList.toggle('is-off', cfg.colour === '#000000');
  r.colour.tName.textContent = swatch ? swatch.name : cfg.colour;
  r.colour.trigger.disabled = !cfg.enabled || isTimbre;
  for (const b of r.swatches) {
    const sel = b.dataset.hex === cfg.colour;
    b.classList.toggle('sel', sel);
    b.setAttribute('aria-checked', String(sel));
  }

  r.patSel.value = cfg.pattern;
  if (r.countSel) {
    // Count is the repetition count for every event pattern, including pulse
    // (where it's whole breathe cycles), so it stays live for all of them.
    r.countSel.value = String(cfg.count);
    r.countSel.disabled = !cfg.enabled;
  }

  const rate = patternRate(cfg.pattern);
  const reps = r.kind === 'event' ? cfg.count : 1;
  if (r.kind === 'event') {
    // The 74px column carries the count, and the burst's cost sits under it.
    const p  = LED_PATTERNS[cfg.pattern];
    const ms = cfg.pattern === 'pulse' ? p.cycleMs * reps : (p.onMs + p.offMs) * reps;
    r.burst.textContent = !cfg.enabled ? 'off'
      : rate === 0 ? '—'
      : `${rate.toFixed(1)}/s · ${(ms / 1000).toFixed(1)}s`;
  } else if (!cfg.enabled)  r.rateCell.textContent = '—';
  // "≤" because hue is quantised: this is the ceiling while sweeping, and
  // holding still costs nothing at all.
  else if (isTimbre)        r.rateCell.textContent = `≤ ${rate.toFixed(0)}/s`;
  else if (rate === 0)      r.rateCell.textContent = '0';
  else                      r.rateCell.textContent = `${rate.toFixed(1)}/s`;

  r.patSel.disabled = !cfg.enabled;
  for (const b of r.swatches) b.disabled = !cfg.enabled || isTimbre;
}

function _syncAll() {
  for (const id of _rows.keys()) _syncRow(id);

  const on = isXimuLedEnabled();
  const pill = document.getElementById('ledMasterPill');
  if (pill) {
    pill.textContent = on ? 'On' : 'Off';
    pill.className = 'set-badge' + (on ? ' set-badge--ok' : '');
  }
  const toggle = document.getElementById('ledMasterToggle');
  if (toggle) toggle.checked = on;

  // Test needs a cursor-assigned device with an LED to talk to.
  const ready = on && hasCursorDevice();
  for (const r of _rows.values()) {
    r.testBtn.disabled = !ready;
    r.testBtn.title = ready
      ? 'fire this row on the cursor device'
      : (on ? 'nothing with an LED currently holds the cursor role' : 'LED feedback is off');
  }
  const status = document.getElementById('ledStatusMeta');
  if (status) {
    status.textContent = !on ? 'Enable to take over the LED.'
      : hasCursorDevice() ? 'Driving the cursor device.'
      : 'No cursor device with an LED — nothing to drive.';
  }
}

// ── Live activity ──────────────────────────────────────────────────────────
// The point of this: the defaults reproduce the old hardcoded palette exactly,
// so watching the LED can't tell you whether this table is driving it. The
// active-row marker and the event readout make the table show its own work.

function _tickLive() {
  const active = getActiveStateId();
  for (const [id, r] of _rows) {
    if (r.kind === 'state') r.el.classList.toggle('is-active', id === active);
  }

  // Live timbre chip + status. Shows the colour currently going to the sensor,
  // or names the stage that's stopping it — every step of the timbre path can
  // fail quietly, so "it's not working" should be self-diagnosing. It lives on
  // the scan row now rather than in a strip at the top, because scan is the row
  // it is about.
  // The engine decides whether timbre is in play at all (`used`), so this stays
  // correct for the interleave patterns too — not just the scan row.
  const st    = timbreStatus();
  const wants = st.used;
  const chip  = document.getElementById('ledTimbreChip');
  const tstat = document.getElementById('ledTimbreStatus');
  const hex   = st.ok ? currentTimbreColour() : null;

  if (chip) {
    chip.hidden = !hex;
    if (hex) { chip.style.background = hex; chip.title = `live timbre — ${hex}`; }
  }
  if (tstat) {
    tstat.hidden = !wants;
    if (wants) {
      tstat.textContent = st.ok
        ? `timbre · ${st.grains} in range · ${st.state}`
        : `timbre — ${st.why}`;
      tstat.classList.toggle('is-blocked', !st.ok);
    }
  }

  const ev = getLastEvent();
  if (!ev.id || ev.at === _lastEventAt) return;
  _lastEventAt = ev.at;

  // Flash the row that just fired so the eye is drawn to it, even if the
  // performer's attention was on the sphere and not the table.
  const r = _rows.get(ev.id);
  if (r && ev.fired) {
    r.el.classList.remove('led-fired');
    void r.el.offsetWidth;            // restart the animation on a repeat hit
    r.el.classList.add('led-fired');
    setTimeout(() => r.el.classList.remove('led-fired'), 700);
  }

  const out = document.getElementById('ledActivity');
  if (out) {
    out.hidden = false;
    out.textContent = ev.fired ? `▸ ${ev.id}` : `▸ ${ev.id} — ${ev.why}`;
    out.className = 'set-badge' + (ev.fired ? ' set-badge--ok' : ' set-badge--warn');
  }
}

function _startLive() {
  if (_liveTimer === null) _liveTimer = setInterval(_tickLive, LIVE_MS);
}
function _stopLive() {
  if (_liveTimer !== null) { clearInterval(_liveTimer); _liveTimer = null; }
}

function _refreshBtnUI() {
  const btn = document.getElementById('ximuLedBtn');
  if (!btn) return;
  const on = isXimuLedEnabled();
  btn.classList.toggle('active', on);
  btn.textContent = on ? '● feedback' : '○ feedback';
  btn.title = on
    ? 'x-IMU3 LED feedback — on. click to open the mapping table.'
    : 'x-IMU3 LED feedback — off. click to open the mapping table.';
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initLedMapUI() {
  const btn    = document.getElementById('ximuLedBtn');
  _modal       = document.getElementById('ledModal');
  const states = document.getElementById('ledStatesTable');
  const events = document.getElementById('ledEventsTable');
  const close  = document.getElementById('ledClose');
  if (!btn || !_modal || !states || !events) return;

  states.appendChild(_tableHead('Rate'));
  for (const row of LED_STATES) states.appendChild(_buildRow(row, 'state'));
  events.appendChild(_tableHead('Count'));
  for (const row of LED_EVENTS) events.appendChild(_buildRow(row, 'event'));

  // The timbre readout belongs to the scan row — it is the only row that can
  // take its colour from the audio.
  const scan = _rows.get('scan');
  if (scan) {
    const chip = document.createElement('span');
    chip.className = 'led-swatch led-timbre-chip';
    chip.id = 'ledTimbreChip';
    chip.hidden = true;
    const tstat = document.createElement('span');
    tstat.className = 'led-fn-when led-activity';
    tstat.id = 'ledTimbreStatus';
    tstat.hidden = true;
    scan.subCell.append(chip, tstat);
  }

  const open = () => { _modal.classList.add('open'); _syncAll(); _tickLive(); _startLive(); };
  const shut = () => {
    _modal.classList.remove('open');
    _stopLive();
    for (const r of _rows.values()) r.el.classList.remove('is-active', 'led-fired');
  };

  btn.addEventListener('click', () => {
    _modal.classList.contains('open') ? shut() : open();
  });
  close?.addEventListener('click', shut);

  document.getElementById('ledMasterToggle')?.addEventListener('click', () => {
    setXimuLedEnabled(!isXimuLedEnabled());
  });
  document.getElementById('ledResetBtn')?.addEventListener('click', () => {
    resetLedMap();
    _syncAll();
  });

  onLedEnabledChange(() => { _refreshBtnUI(); _syncAll(); });

  // Cursor assignment can change while the page is up — that's what gates the
  // test buttons, so re-sync when it does. _visible(), not the overlay's class:
  // hosted in the settings shell there is no `.open` to read.
  window.addEventListener('sensor-status', () => {
    if (_visible()) _syncAll();
  });

  _refreshBtnUI();

  S.openLedModal  = open;
  S.closeLedModal = shut;
}
