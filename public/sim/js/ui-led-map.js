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
let _body  = null;
let _rows  = new Map();   // id → { tr, swatches, patSel, countSel, rateCell, testBtn, onChk }

// Live readout — runs only while the modal is open. 10 Hz is well below frame
// rate and reads no hardware; it just mirrors two engine getters.
let _liveTimer   = null;
let _lastEventAt = 0;
const LIVE_MS    = 100;

// ── Row construction ───────────────────────────────────────────────────────

function _buildSwatches(id, td) {
  const wrap = document.createElement('div');
  wrap.className = 'led-swatches';
  const btns = [];
  for (const { hex, name } of LED_PALETTE) {
    const b = document.createElement('button');
    b.className = 'led-swatch';
    b.style.background = hex;
    b.title = name;
    b.dataset.hex = hex;
    // Black needs an outline or it's invisible against the dialog background.
    if (hex === '#000000') b.classList.add('is-off');
    b.addEventListener('click', () => {
      setLedEntry(id, { colour: hex });
      _syncRow(id);
    });
    wrap.appendChild(b);
    btns.push(b);
  }
  td.appendChild(wrap);
  return btns;
}

function _buildPatternSelect(id, kind, td) {
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
  td.appendChild(sel);
  return sel;
}

function _buildCountSelect(id, td) {
  const sel = document.createElement('select');
  sel.className = 'acc-select led-select led-count';
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
  td.appendChild(sel);
  return sel;
}

function _buildRow(row, kind) {
  const tr = document.createElement('tr');
  tr.className = `led-row led-row-${kind}`;

  // on
  const tdOn = document.createElement('td');
  const chk  = document.createElement('input');
  chk.type = 'checkbox';
  chk.addEventListener('change', () => {
    setLedEntry(row.id, { enabled: chk.checked });
    _syncRow(row.id);
  });
  tdOn.appendChild(chk);

  // function
  const tdFn = document.createElement('td');
  tdFn.className = 'fn-name led-fn';
  tdFn.textContent = row.label;
  if (row.tip) tdFn.title = row.tip;

  const tdColour = document.createElement('td');
  const tdPat    = document.createElement('td');
  const tdCount  = document.createElement('td');
  const tdRate   = document.createElement('td');
  tdRate.className = 'led-rate';

  const tdTest = document.createElement('td');
  const test   = document.createElement('button');
  test.className = 'learn-btn led-test';
  test.textContent = '▸ test';
  test.addEventListener('click', () => testLedEntry(row.id));
  tdTest.appendChild(test);

  tr.append(tdOn, tdFn, tdColour, tdPat, tdCount, tdRate, tdTest);

  const swatches = _buildSwatches(row.id, tdColour);
  const patSel   = _buildPatternSelect(row.id, kind, tdPat);
  const countSel = kind === 'event' ? _buildCountSelect(row.id, tdCount) : null;
  if (!countSel) tdCount.innerHTML = '<span class="led-na">—</span>';

  _rows.set(row.id, { tr, kind, swatches, patSel, countSel, rateCell: tdRate, testBtn: test, onChk: chk });
  return tr;
}

function _sectionRow(label) {
  const tr = document.createElement('tr');
  tr.className = 'led-section';
  const td = document.createElement('td');
  td.colSpan = 7;
  td.textContent = label;
  tr.appendChild(td);
  return tr;
}

// ── Sync ───────────────────────────────────────────────────────────────────

function _syncRow(id) {
  const r   = _rows.get(id);
  const cfg = getLedMap()[id];
  if (!r || !cfg) return;

  r.onChk.checked = cfg.enabled;
  r.tr.classList.toggle('is-off', !cfg.enabled);

  // Timbre takes its colour from the audio, so the swatch strip doesn't apply.
  // Dim it rather than hiding it, so switching back to solid doesn't make the
  // row jump — and so it's obvious the swatches are still remembered.
  // Only the pure timbre pattern ignores the swatch. The interleaves alternate
  // *against* the swatch colour, so it still matters there.
  const isTimbre = cfg.pattern === 'timbre';
  r.tr.classList.toggle('is-timbre', isTimbre);

  for (const b of r.swatches) b.classList.toggle('sel', b.dataset.hex === cfg.colour);

  r.patSel.value = cfg.pattern;
  if (r.countSel) {
    // Count is the repetition count for every event pattern, including pulse
    // (where it's whole breathe cycles), so it stays live for all of them.
    r.countSel.value = String(cfg.count);
    r.countSel.disabled = !cfg.enabled;
  }

  const rate = patternRate(cfg.pattern);
  const reps = r.kind === 'event' ? cfg.count : 1;
  if (!cfg.enabled)       r.rateCell.textContent = '—';
  // "≤" because hue is quantised: this is the ceiling while sweeping, and
  // holding still costs nothing at all.
  else if (isTimbre)      r.rateCell.textContent = `≤ ${rate.toFixed(0)}/s`;
  else if (rate === 0)    r.rateCell.textContent = '0';
  else if (r.kind === 'event') {
    // Events are bursts, so the honest number is what it costs while running
    // plus how long that is.
    const p   = LED_PATTERNS[cfg.pattern];
    const ms  = cfg.pattern === 'pulse' ? p.cycleMs * reps : (p.onMs + p.offMs) * reps;
    r.rateCell.textContent = `${rate.toFixed(1)}/s · ${(ms / 1000).toFixed(1)}s`;
  } else {
    r.rateCell.textContent = `${rate.toFixed(1)}/s`;
  }

  r.patSel.disabled   = !cfg.enabled;
  for (const b of r.swatches) b.disabled = !cfg.enabled || isTimbre;
}

function _syncAll() {
  for (const id of _rows.keys()) _syncRow(id);

  const on = isXimuLedEnabled();
  const pill = document.getElementById('ledMasterPill');
  if (pill) {
    pill.textContent = on ? 'feedback on' : 'feedback off';
    pill.classList.toggle('live', on);
  }
  const toggle = document.getElementById('ledMasterToggle');
  if (toggle) toggle.textContent = on ? 'turn off' : 'turn on';

  // Test needs a cursor-assigned x-IMU3 to talk to.
  const ready = on && hasCursorDevice();
  for (const r of _rows.values()) {
    r.testBtn.disabled = !ready;
    r.testBtn.title = ready
      ? 'fire this row on the cursor x-IMU3'
      : (on ? 'no x-IMU3 currently holds the cursor role' : 'LED feedback is off');
  }
  const status = document.getElementById('ledStatusMeta');
  if (status) {
    status.textContent = !on ? 'enable to take over the LED'
      : hasCursorDevice() ? 'driving the cursor x-IMU3'
      : 'no cursor x-IMU3 — nothing to drive';
  }
}

// ── Live activity ──────────────────────────────────────────────────────────
// The point of this: the defaults reproduce the old hardcoded palette exactly,
// so watching the LED can't tell you whether this table is driving it. The
// active-row marker and the event readout make the table show its own work.

function _tickLive() {
  const active = getActiveStateId();
  for (const [id, r] of _rows) {
    if (r.kind === 'state') r.tr.classList.toggle('is-active', id === active);
  }

  // Live timbre chip + status. Shows the colour currently going to the sensor,
  // or names the stage that's stopping it — every step of the timbre path can
  // fail quietly, so "it's not working" should be self-diagnosing.
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
    r.tr.classList.remove('led-fired');
    void r.tr.offsetWidth;            // restart the animation on a repeat hit
    r.tr.classList.add('led-fired');
    setTimeout(() => r.tr.classList.remove('led-fired'), 700);
  }

  const out = document.getElementById('ledActivity');
  if (out) {
    out.textContent = ev.fired ? `▸ ${ev.id}` : `▸ ${ev.id} — ${ev.why}`;
    out.classList.toggle('is-blocked', !ev.fired);
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
  const btn   = document.getElementById('ximuLedBtn');
  _modal      = document.getElementById('ledModal');
  _body       = document.getElementById('ledTableBody');
  const close = document.getElementById('ledClose');
  if (!btn || !_modal || !_body) return;

  _body.appendChild(_sectionRow('states — held while the condition is true'));
  for (const row of LED_STATES) _body.appendChild(_buildRow(row, 'state'));
  _body.appendChild(_sectionRow('events — fire once, then the state resumes'));
  for (const row of LED_EVENTS) _body.appendChild(_buildRow(row, 'event'));

  const open = () => { _modal.classList.add('open'); _syncAll(); _tickLive(); _startLive(); };
  const shut = () => {
    _modal.classList.remove('open');
    _stopLive();
    for (const r of _rows.values()) r.tr.classList.remove('is-active', 'led-fired');
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

  // Cursor assignment can change while the modal sits open — that's what
  // gates the test buttons, so re-sync when it does.
  window.addEventListener('sensor-status', () => {
    if (_modal.classList.contains('open')) _syncAll();
  });

  _refreshBtnUI();

  S.openLedModal  = open;
  S.closeLedModal = shut;
}
