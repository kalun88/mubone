// ui-buttons.js — Settings → Instrument buttons (Ek, 2026-09-09)
//
// "there should be a clear indication somewhere of what long and short means,
// and the double/triple click behaviour. maybe even setting what those seconds
// are." The recogniser and the map live in midi.js; this page is where they
// are READ: what each of the three buttons does on each gesture, the two
// windows, and a live line showing the last gesture the instrument sent, so
// a binding can be checked without opening the keys page. The buttons are the
// mubone instrument's three (sygaldry.js → S._dispatchButton); an x-imu3 has none.
import { S } from './state.js';

const GESTURES = ['press', 'tap', 'long', 'xlong', 'double', 'triple'];
const HEAD     = { press: 'Press', tap: 'Tap', long: 'Long', xlong: 'Extra long', double: '×2', triple: '×3' };

function _visible() { return !!document.getElementById('setPanelButtons')?.closest('#settingsHost'); }

function renderButtonsTable() {
  const table = document.getElementById('buttonsTable');
  if (!table) return;
  const bound = S._buttonBindings?.() || [];
  const at = (btn, g) => bound.find(b => b.btn === btn && b.g === g);
  let html = `<div class="set-table-head set-table-row"><span>Button</span>${GESTURES.map(g => `<span>${HEAD[g]}</span>`).join('')}</div>`;
  for (const btn of [1, 2, 3]) {
    html += `<div class="set-table-row"><span class="set-row-title">${btn}</span>` +
      GESTURES.map(g => { const b = at(btn, g); return `<span class="${b ? '' : 'as-dim'}">${b ? b.label : '—'}</span>`; }).join('') +
      `</div>`;
  }
  table.innerHTML = html;
}

function paintTiming() {
  const t = S._buttonTiming?.get();
  if (!t) return;
  const lo = document.getElementById('buttonsLong'), ta = document.getElementById('buttonsTap');
  const xl = document.getElementById('buttonsXlong');
  if (xl && document.activeElement !== xl) xl.value = t.xlong;
  if (lo && document.activeElement !== lo) lo.value = t.long;
  if (ta && document.activeElement !== ta) ta.value = t.tap;
}

// ── How a button is read, drawn ─────────────────────────────────────────────
// One spec per row (Ek, 2026-09-10: "make it a table and more graphically
// understandable for a visual learner"). The timeline is 200 × 40 units with no
// scale — the window and the hold are shapes, not numbers, because the numbers
// are the three settings above and the player moves them. presses [d, u] in
// 0..200; band [a, b] the window; hold [a, b] the count to long; dots {x, kind}
// where kind is fire · struck (taken back) · hollow (the same fire, waited);
// on [a, b] a momentary's on-time.
const HOW = [
  { g: 'Press',      fires: 'At the down. Never delayed.',
    use: 'When the moment matters — a take, a pin on the beat. It fires on every gesture of its button.',
    presses: [[20, 60]], dots: [{ x: 20 }] },
  { g: 'Tap',        fires: 'At the up. Beside a ×2 or ×3, when the window after it closes.',
    use: 'When being sure matters more than the moment.',
    presses: [[20, 60]], band: [60, 110], dots: [{ x: 60 }, { x: 110, kind: 'hollow' }] },
  { g: '×2',         fires: 'At the second down, inside the window after the first release.',
    use: 'A second meaning on the same button. Exactly one of tap, ×2 and ×3 fires for a sequence.',
    presses: [[20, 50], [80, 110]], band: [50, 100], dots: [{ x: 80 }] },
  { g: '×3',         fires: 'At the third down, inside the window after the second release.',
    use: 'A third meaning. The ×2 waits one window when a ×3 is bound beside it.',
    presses: [[20, 45], [70, 95], [120, 145]], band: [45, 70], band2: [95, 120], dots: [{ x: 120 }] },
  { g: 'Long',       fires: 'At the long time, still held.',
    use: 'A hold. It ends any tap count; the release fires nothing of its own.',
    presses: [[20, 160]], hold: [20, 90], dots: [{ x: 90 }] },
  { g: 'Extra long', fires: 'At the extra-long time, after long has fired.',
    use: 'A longer hold, for what can follow a long.',
    presses: [[20, 180]], hold: [20, 60], hold2: [60, 150], dots: [{ x: 60 }, { x: 150 }] },
  { group: 'Beside a press' },
  { g: 'Take-back',  fires: 'First takes back what the press did, then fires its own action.',
    use: 'A take thrown away, a pin removed, a sweep undone — as if never meant.',
    presses: [[20, 160]], hold: [20, 90], dots: [{ x: 20, kind: 'struck' }, { x: 90 }] },
  { group: 'What the action is' },
  { g: 'Toggle · bang', fires: 'Once, at its gesture\'s edge. Nothing at the release.',
    use: 'The action\'s choice, not the button\'s.',
    presses: [[20, 120]], dots: [{ x: 20 }] },
  { g: 'Momentary',  fires: 'On at its gesture\'s edge, off at the release.',
    use: 'Any gesture with two edges — never a tap, which has none.',
    presses: [[20, 120]], dots: [{ x: 20 }, { x: 120, kind: 'off' }], on: [20, 120] },
];
function _howSvg(r) {
  const lo = 26, hi = 12;
  let d = `M 4 ${lo}`;
  for (const [a, b] of r.presses) d += ` L ${a} ${lo} L ${a} ${hi} L ${b} ${hi} L ${b} ${lo}`;
  d += ` L 196 ${lo}`;
  let s = `<svg class="how-svg" viewBox="0 0 200 40" aria-hidden="true">`;
  for (const k of ['band', 'band2']) if (r[k]) s += `<rect x="${r[k][0]}" y="${lo + 3}" width="${r[k][1] - r[k][0]}" height="6" rx="1.5" class="how-band"/>`;
  for (const k of ['hold', 'hold2']) if (r[k]) s += `<line x1="${r[k][0]}" y1="${lo + 6}" x2="${r[k][1]}" y2="${lo + 6}" class="how-hold"/>`;
  if (r.on) s += `<line x1="${r.on[0]}" y1="${lo + 9}" x2="${r.on[1]}" y2="${lo + 9}" class="how-on"/>`;
  s += `<path d="${d}" class="how-trace"/>`;
  for (const p of r.dots) {
    const y = r.presses.some(([a, b]) => p.x > a && p.x < b) ? hi : (r.presses.some(([a]) => a === p.x) ? hi : lo);
    if (p.kind === 'hollow') s += `<circle cx="${p.x}" cy="${y}" r="3.2" class="how-dot how-dot--hollow"/>`;
    else if (p.kind === 'off') s += `<circle cx="${p.x}" cy="${y}" r="3.2" class="how-dot how-dot--off"/>`;
    else s += `<circle cx="${p.x}" cy="${y}" r="3.2" class="how-dot"/>`;
    if (p.kind === 'struck') s += `<path d="M ${p.x - 5} ${y - 5} L ${p.x + 5} ${y + 5} M ${p.x + 5} ${y - 5} L ${p.x - 5} ${y + 5}" class="how-strike"/>`;
  }
  return s + `</svg>`;
}
function renderHowTable() {
  const t = document.getElementById('buttonsHowTable');
  if (!t) return;
  let html = `<div class="set-table-head set-table-row"><span>Gesture</span><span>The button</span><span>Fires</span><span>Use it for</span></div>`;
  for (const r of HOW) {
    if (r.group) { html += `<div class="set-table-row how-group">${r.group}</div>`; continue; }
    html += `<div class="set-table-row how-row"><span class="set-row-title">${r.g}</span><span>${_howSvg(r)}</span><span class="how-text">${r.fires}</span><span class="how-text">${r.use}</span></div>`;
  }
  t.innerHTML = html;
}

export function initButtonsPage() {
  const wire = (id, key) => {
    const el = document.getElementById(id);
    el?.addEventListener('change', () => {
      const v = Math.round(Number(el.value));
      if (!Number.isFinite(v)) { paintTiming(); return; }
      const lo = key === 'tap' ? 30 : 100, hi = key === 'xlong' ? 5000 : 2000;
      S._buttonTiming?.set({ [key]: Math.max(lo, Math.min(hi, v)) });
      paintTiming();
    });
  };
  renderHowTable();
  // The Defaults row reads the code's numbers — nothing is baked into the page
  // (Ek, 2026-09-10: "i'll be actively playing with the ms timings").
  const d = S._buttonTiming?.defaults, dd = document.getElementById('buttonsDefaultsDesc');
  if (d && dd) dd.textContent = `Long ${d.long} ms, extra long ${d.xlong} ms, tap window ${d.tap} ms.`;
  wire('buttonsLong',  'long');
  wire('buttonsXlong', 'xlong');
  wire('buttonsTap',   'tap');
  document.getElementById('buttonsReset')?.addEventListener('click', () => {
    S._buttonTiming?.set(S._buttonTiming.defaults); paintTiming();
  });
  document.getElementById('buttonsToKeys')?.addEventListener('click', () => S._openSettings?.('keys'));

  // The live monitor: a ring of the last forty gestures, painted once per
  // frame at most and only while the page is on screen. The ring costs a
  // string per gesture — a few a second at the very most — and the paint is
  // the keys page's monitor pattern. Closed, nothing runs.
  const RING = 40;
  const ring = [];
  let dirty = false, rafQueued = false;
  const log = document.getElementById('buttonsMonLog');
  const count = document.getElementById('buttonsMonCount');
  const paint = () => {
    if (!log) return;
    log.innerHTML = '';
    if (!ring.length) {
      const empty = document.createElement('div');
      empty.className = 'set-empty';
      empty.textContent = 'Nothing received yet.';
      log.appendChild(empty);
    } else {
      for (const line of ring) {
        const d = document.createElement('div');
        d.className = 'mon-line';
        d.textContent = line;
        log.appendChild(d);
      }
      log.scrollTop = log.scrollHeight;
    }
    if (count) count.textContent = String(ring.length);
  };
  const schedule = () => {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => { rafQueued = false; if (dirty && _visible()) { paint(); dirty = false; } });
  };
  window.addEventListener('button-gesture', e => {
    const { btn, srcLabel, g, down, label } = e.detail;
    // The recogniser reports every source it reads — keys and MIDI notes too,
    // the spacebar on every press. This page is the instrument's buttons.
    if (btn == null) return;
    // One line per gesture: a press shows both edges (the take's start and
    // end are the point of it); the others show the edge they fire on.
    if (!down && g !== 'press') return;
    const when = new Date().toTimeString().slice(0, 8);
    const what = g === 'press' ? (down ? 'press' : 'release') : HEAD[g].toLowerCase();
    ring.push(`${when}  ${srcLabel} · ${what}  →  ${label || (down ? 'unbound' : '')}`.trimEnd());
    if (ring.length > RING) ring.shift();
    dirty = true;
    if (_visible()) schedule();
  });
  document.getElementById('buttonsMonClear')?.addEventListener('click', () => { ring.length = 0; paint(); });
  const prev = S._onSettingsSection;
  S._onSettingsSection = (id) => { prev?.(id); if (id === 'buttons') { paint(); renderButtonsTable(); paintTiming(); } };
  const prevB = S._bindingsChanged;
  S._bindingsChanged = () => { prevB?.(); if (_visible()) renderButtonsTable(); };
}
