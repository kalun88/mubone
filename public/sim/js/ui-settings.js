// ============================================================================
// ui-settings.js — the one settings door (#255)
//
// The rig view scattered its settings across fifteen header chips and seven
// footer chips, and the tile screen has no room for either bar. This is the
// replacement: one modal, a left nav, one section showing at a time.
//
// ── How a section is shown, and why it is done this way ────────────────────
// Nine of the sections already exist as modals (`#audioSettingsModal`,
// `#imuSetupModal`, …), each an `.mu-overlay` wrapping one `.mu-dialog`, each
// wired by its own module through `getElementById` on descendants. So this
// file does NOT rebuild them and does not copy any control: it MOVES the
// `.mu-dialog` node into `#settingsHost`, and moves it back to its overlay on
// close. Listeners survive reparenting and ids do not change, so every module
// keeps working with no knowledge of this one — and there is never a second
// copy of a control to fall out of sync, which is the cc-mirror lesson
// (CLAUDE.md) applied by construction rather than by vigilance.
//
// The two sections with no modal of their own — view and session — are parked
// in `#settingsPanels` and hosted the same way. Their controls are PROXIES
// (`data-proxy="<id>"` clicks the real button), the same pattern the tile
// chrome uses, for the same reason.
//
// ── Sunset 2026-08-28 (#269) ───────────────────────────────────────────────
// Gone from the nav, and their markup and modules moved to
// `sandbox/sunset-2026-08-28/`: the **sample instrument** modal (the sampler
// lives in the tool rail's source group now, with its library in the
// properties rail), **gesture**, **staging** and the **accessory** table.
// Nothing in the app consumed gesture or staging; the accessory DATA layer
// (`accessory-registry.js`) stays wired because the setup file carries it —
// only its table went.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
// The commits device is BORROWED from the rig view rather than rebuilt as a
// pins page (#262) — see the `node` section type. Same rule as the modals:
// move the node, never copy a control.
//
// `patchTableBtn` — patches are not a thing in the old sense any more (Ek),
// so the patch table is left in the rig view rather than given a nav item. It
// is not deleted: that is a separate decision, and deleting it would take the
// PARAM_REGISTRY editor with it.
// ============================================================================

import { S, perf } from './state.js';

// ── The OSC reference is FOLDED (round eleven) ─────────────────────────────
// It listed every advertised address with its data type, kind and key — all of
// which the keys + MIDI page now carries per row: the address and format have
// been that page's Action sub-line since round eight, and `type` joined them
// here. Its legends were already that page's Reference block. One page, one
// place, and it still cannot drift from ACTIONS because it is still generated
// from ACTIONS.
// Each section: what it is called, and where its body comes from. `modal` is
// an overlay whose dialog gets borrowed; `panel` is one of ours; `node` is any
// element in the rig view borrowed whole (the commits device — #262).
// One 16px icon per section, drawn from primitives only — circle, square,
// diamond, rounded rect, dot, straight path (DESIGN-SYSTEM § 2's shape
// language, and SETTINGS-GUI § 4's "one 16px primitive-shape icon each").
// stroke 1.4 and currentColor, so a row's icon is the row's own text colour
// and selection needs no second rule.
const ICON = {
  audio:    '<circle cx="8" cy="8" r="5.2"/>',
  pins:     '<rect x="2.5" y="3.5" width="11" height="9" rx="2"/><path d="M9.5 3.5v9"/>',
  sensors:  '<path d="M8 2.4 13.6 8 8 13.6 2.4 8Z"/>',
  mapping:  '<circle cx="4.2" cy="4.6" r="1.7"/><circle cx="11.8" cy="11.4" r="1.7"/><path d="M5.6 5.9 10.4 10.1"/>',
  feedback: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.5"/>',
  viz:      '<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><circle cx="8" cy="8" r="2.6"/>',
  view:     '<rect x="2" y="3.5" width="12" height="9" rx="2"/><path d="M2 6.6h12"/>',
  keys:     '<rect x="2" y="4.5" width="5" height="7" rx="1"/><rect x="9" y="4.5" width="5" height="7" rx="1"/>',
  buttons:  '<rect x="2.5" y="4" width="11" height="8" rx="2.5"/><circle cx="8" cy="8" r="1.6"/>',
  osc:      '<path d="M3 5h10"/><path d="M3 8h10"/><path d="M3 11h6"/>',
  diag:     '<path d="M2 8h3l2-4 2 8 2-5 1.5 3H14"/>',
  session:  '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 5.2v5.3"/><path d="M5.9 8.4 8 10.5l2.1-2.1"/>',
};

// Each section: what it is called, and where its body comes from. `modal` is
// an overlay whose dialog gets borrowed; `panel` is one of ours; `node` is any
// element in the rig view borrowed whole (the commits device — #262).
// `action` is a page-level button the header borrows while the page is open
// (SETTINGS-GUI § 4) — a thing the PAGE does, which is not a row.
// Labels are sentence case: inside this dialog the app runs prose (§ 5), and
// the shell's title is this same string.
const SECTIONS = [
  { id: 'audio',     label: 'Audio',        group: 'sound',   modal: 'audioSettingsModal', opener: 'audioSettingsBtn', closer: 'audioSettingsClose', action: 'asTestBtn' },
  // Pins were the rig view's "commits" device. Same node, borrowed — every
  // control in it keeps its id, its listener and its wiring (#262).
  { id: 'pins',      label: 'Pins',         group: 'sound',   node: 'commitPanel' },
  { id: 'sensors',   label: 'Sensors',      group: 'sensor',  modal: 'imuSetupModal', opener: 'imuSetupBtn', closer: 'imuSetupClose' },
  { id: 'mapping',   label: 'Mapping',      group: 'sensor',  modal: 'sensorMappingModal', opener: 'mappingBtn', closer: 'sensorMappingClose', action: 'sensorMappingAddBtn' },
  { id: 'feedback',  label: 'LED feedback', group: 'sensor',  modal: 'ledModal', opener: 'ximuLedBtn', closer: 'ledClose', action: 'ledResetBtn' },
  { id: 'viz',       label: 'Visuals',      group: 'view',    modal: 'vizModal', opener: 'vizSettingsBtn', closer: 'vizModalClose' },
  { id: 'view',      label: 'Camera + display', group: 'view', panel: 'setPanelView' },
  { id: 'keys',      label: 'Keys + MIDI',   group: 'control', modal: 'mappingModal', opener: 'helpBtn', closer: 'mappingClose', action: 'keysClearAll' },
  { id: 'buttons',   label: 'Instrument buttons', group: 'control', panel: 'setPanelButtons' },
  { id: 'diag',      label: 'Diagnostics',  group: 'control', panel: 'setPanelDiag' },
  { id: 'session',   label: 'Export · import · reset', group: 'control', panel: 'setPanelSession' },
];
const GROUP_LABEL = { sound: 'sound', sensor: 'sensors', view: 'view', control: 'control' };


// ── The borrow ledger (#262, round twenty) ─────────────────────────────────
// The shell does not copy controls, it MOVES the real ones out of the rig
// cabinet and gives them back on close. Two facts were already tracked — WHAT
// was borrowed (whatever sits in #settingsHost) and WHICH PARENT it came from
// (`_home`, `_actHome`, `_camHome`). The third was not: the INDEX.
//
// Every return was `parent.appendChild(node)`, which puts the node at the END
// of its parent rather than back where it was. Measured: opening Settings →
// Pins once and closing moves #commitPanel from index 7 to index 8 of
// .right-panel — `… play commitPanel trigger` becomes `… play trigger
// commitPanel` — and it stays that way until a reload. Navigating away from the
// page instead of closing does the same. Nothing noticed, because the cabinet
// is display:none and everything addresses it by id.
//
// So the ledger records parent AND index, and is the single answer to "is
// anything on loan right now". It replaces a probe that was guessing at this
// with a retry loop and a child count.
const _ledger = [];

function _borrow(node, what) {
  if (!node || !node.parentElement) return null;
  const parent = node.parentElement;
  _ledger.push({ node, parent, index: [...parent.children].indexOf(node), what });
  return node;
}

/** Put a borrowed node back where it came from — position included. */
function _return(node) {
  const i = _ledger.findIndex(e => e.node === node);
  if (i < 0) return false;
  const { parent, index } = _ledger[i];
  parent.insertBefore(node, parent.children[index] || null);
  _ledger.splice(i, 1);
  return true;
}

/** What is on loan right now. Empty is the only correct resting state: a leaked
 *  borrow leaves the rig a node short. Read by scripts/screen-probe.mjs and
 *  asserted by align-audit. */
export function settingsBorrowed() {
  return _ledger.map(e => ({
    what: e.what,
    node: e.node.id || (e.node.className || '').toString().split(' ')[0] || e.node.tagName,
    parent: e.parent.id || (e.parent.className || '').toString().split(' ')[0] || e.parent.tagName,
    index: e.index,
  }));
}

let _open = null;          // section id currently hosted
let _home = null;          // where its node came from, so it can go back
let _actHome = null;       // and the same for the page action the header borrows
let _camHome = null;       // the camera picker's seat in the rig top bar

/** The camera picker is live segmented state, so the view panel BORROWS the
 *  real one rather than mirroring it — same rule as the dialogs, and the same
 *  obligation: give it back. Held permanently it vanishes from the rig view
 *  entirely, because the panel it would be sitting in is `hidden`. */
function _borrowCamera(on) {
  const seg = document.getElementById('cameraModeSeg');
  const slot = document.getElementById('setCameraSlot');
  if (!seg || !slot || !_camHome) return;
  if (on) { _borrow(seg, 'camera picker'); slot.appendChild(seg); }
  else if (!_return(seg)) _camHome.appendChild(seg);
}

/** A page-level action (Speaker sweep) sits in the shell header, left of the
 *  ✕ — SETTINGS-GUI § 4. Borrowed, never copied, on the same terms as the
 *  dialog bodies and the camera picker: the real button keeps its id and its
 *  listener, and it goes home when the page is put away. */
function _borrowAction(sec) {
  const slot = document.getElementById('settingsHeadActions');
  if (!slot || !sec?.action) return;
  const btn = document.getElementById(sec.action);
  if (!btn) return;
  _actHome = btn.parentElement;
  _borrow(btn, 'header action');
  slot.appendChild(btn);
}
function _returnAction() {
  const slot = document.getElementById('settingsHeadActions');
  const btn  = slot?.firstElementChild;
  if (btn && !_return(btn) && _actHome) _actHome.appendChild(btn);
  _actHome = null;
}

/** Paint every range's fill (#288).
 *
 *  `appearance: none` is what lets the settings sliders wear the same 2px
 *  track and 2px handle as an engine row — and it also removes the one thing
 *  a native range gives you for free, the coloured portion to the left of the
 *  thumb. There is no CSS-only way back, so the percentage is written onto the
 *  element as `--fill` and the track's gradient reads it. Cheap: it runs on
 *  input and once per page show, never on a timer. */
export function paintRange(el) {
  const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
  const v = parseFloat(el.value);
  const span = max - min;
  const pct = span > 0 && Number.isFinite(v)
    ? Math.max(0, Math.min(100, ((v - min) / span) * 100)) : 0;
  el.style.setProperty('--fill', pct.toFixed(2));
}
function _paintAllRanges(root) {
  root?.querySelectorAll('input[type=range]').forEach(paintRange);
}

/* Every horizontal slider in the app wears the engine row's design now (#293),
 * not just the ones inside a settings page — so `--fill` has to be maintained
 * everywhere, not just where this module happens to be looking.
 *
 * A single delegated listener in the CAPTURE phase does it: capture, because a
 * handler somewhere else stopping propagation would otherwise leave that one
 * slider permanently unpainted, and it would be invisible until someone dragged
 * it. Programmatic writes are covered too — the mirror contract already
 * requires anything assigning `el.value` to dispatch `input` (see
 * cc-mirror-audit.js), which is the same event this listens for. */
function _wireRangeFill() {
  const paint = e => { const t = e.target; if (t?.type === 'range') paintRange(t); };
  document.addEventListener('input',  paint, true);
  document.addEventListener('change', paint, true);
  _paintAllRanges(document);
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', _wireRangeFill, { once: true });
else _wireRangeFill();

function _bodyFor(sec) {
  const src = document.getElementById(sec.modal || sec.panel || sec.node);
  if (!src) return null;
  return sec.modal ? src.querySelector('.mu-dialog') : src;
}

/** Put the previous section's node back where it lives. Always paired with
 *  show(); a node left in the host is a modal that will open EMPTY next time
 *  someone presses its old button in the rig view. */
function _restore() {
  if (!_open || !_home) { _open = null; _home = null; return; }
  // And the section's own CLOSE path, for the same reason: closing the keys
  // page has to cancel an armed MIDI/key learn, or it stays armed invisibly
  // and eats the next thing you press.
  const sec = SECTIONS.find(s => s.id === _open);
  if (sec?.closer) document.getElementById(sec.closer)?.click();
  // Before the body moves: the action's home is inside it.
  _returnAction();
  const host = document.getElementById('settingsHost');
  if (_open === 'view') _borrowCamera(false);
  if (_open === 'view' || _open === 'viz') _viewStats(false);
  const node = host?.firstElementChild;
  if (node) {
    node.classList.remove('in-settings');
    // The ledger knows the index; appendChild does not. Falling back to append
    // only if the ledger somehow lost it keeps the node reachable either way.
    if (!_return(node)) _home.appendChild(node);
  }
  _open = null; _home = null;
}

// ── The view page's live number ─────────────────────────────────────────────
// SETTINGS-GUI § 2: a live value is a STATUS line, not part of the description
// — a description is prose someone may rewrite, and a number is not. Runs only
// while that page is open, at 2 Hz, which is as fast as a frame time is worth
// reading.
let _viewStatTick = null;
// Two pages carry the same number, and for the same reason: it is the number
// that tells you whether you need the control beside it.
const _PERF_STAT_IDS = ['setViewPerfStat', 'vizPerfStat'];
function _viewStats(on) {
  if (_viewStatTick) { clearInterval(_viewStatTick); _viewStatTick = null; }
  if (!on) return;
  const paint = () => {
    const ms = perf.frameMs || 0;
    const txt = ms > 0
      ? `${ms.toFixed(1)} ms per frame · ${Math.round(1000 / ms)} fps · ${perf.activeNodes || 0} grains`
      : '—';
    for (const id of _PERF_STAT_IDS) {
      const el = document.getElementById(id);
      if (el && el.offsetParent) el.textContent = txt;
    }
  };
  paint();
  _viewStatTick = setInterval(paint, 500);
}

function show(id) {
  const sec = SECTIONS.find(s => s.id === id);
  if (!sec || _open === id) return;
  _restore();
  const host = document.getElementById('settingsHost');
  const body = _bodyFor(sec);
  if (!host || !body) return;
  // ── Run the section's OWN open path (#270) ──────────────────────────────
  // Several of these modals do real work when their button is pressed —
  // `renderMappingTable()` fills the keys/MIDI table, `onOpen()` rescans
  // sensors, the audio modal repopulates its device lists. Moving the node
  // alone bypassed all of it, so the keys page arrived with an EMPTY table and
  // no learn buttons. Rather than duplicate each module's open logic here (a
  // second copy that would drift), press its real button and then take the
  // overlay back down before it can paint: the module runs exactly the code it
  // always ran, and the shell still owns where the dialog ends up.
  if (sec.opener) {
    document.getElementById(sec.opener)?.click();
    document.getElementById(sec.modal)?.classList.remove('open');
  }
  _home = body.parentElement;
  _borrow(body, 'page: ' + id);
  body.classList.add('in-settings');
  host.appendChild(body);
  _open = id;
  // A page that computes something on arrival says so here rather than polling
  // for its own visibility — diagnostics recomputes its readiness verdict.
  S._onSettingsPageShown?.(id);
  if (id === 'view') _borrowCamera(true);
  _viewStats(id === 'view' || id === 'viz');
  _borrowAction(sec);

  const title = document.getElementById('settingsTitle');
  if (title) title.textContent = sec.label;
  document.querySelectorAll('#settingsNav [data-sec]').forEach(b =>
    b.classList.toggle('active', b.dataset.sec === id));
  try { localStorage.setItem('mubone_settings_section', id); } catch (_) {}
  // Panels that size themselves on open (meters, canvases, tables) only ever
  // heard about it through their own open button. Say it once, generically.
  _paintAllRanges(host);
  window.dispatchEvent(new Event('resize'));
  S._onSettingsSection?.(id);
}

export function openSettings(id) {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  let want = id;
  if (!want) {
    try { want = localStorage.getItem('mubone_settings_section'); } catch (_) {}
  }
  if (!SECTIONS.some(s => s.id === want)) want = SECTIONS[0].id;
  modal.classList.add('open');
  show(want);
}

export function closeSettings() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  modal.classList.remove('open');
  // The node goes home BEFORE the overlay is reused, never after: the rig
  // view's own buttons still open these modals until it is retired.
  _restore();
}

export function settingsOpen() {
  return !!document.getElementById('settingsModal')?.classList.contains('open');
}

export function initSettings() {
  const modal = document.getElementById('settingsModal');
  const nav   = document.getElementById('settingsNav');
  if (!modal || !nav) return;

  let html = '', lastGroup = null;
  for (const sec of SECTIONS) {
    if (sec.group !== lastGroup) {
      lastGroup = sec.group;
      html += `<span class="set-nav-grp">${GROUP_LABEL[sec.group] ?? sec.group}</span>`;
    }
    const icon = ICON[sec.id]
      ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" `
        + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[sec.id]}</svg>`
      : '';
    html += `<button type="button" class="set-nav-item" data-sec="${sec.id}">${icon}<span>${sec.label}</span></button>`;
  }
  nav.innerHTML = html;
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-sec]');
    if (b) show(b.dataset.sec);
  });

  // One delegated listener for every range in every page — the pages are
  // borrowed from modules that know nothing about this shell, so nothing can
  // be asked of them.
  const host = document.getElementById('settingsHost');
  host?.addEventListener('input', e => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') paintRange(e.target);
  });

  // The ledger is readable from the console and from the harnesses. Nothing in
  // the app depends on it; it exists so "is anything on loan" is a fact rather
  // than a guess (round twenty).
  S._settingsBorrowed = settingsBorrowed;
  document.getElementById('settingsClose')?.addEventListener('click', closeSettings);
  modal.addEventListener('click', e => { if (e.target === modal) closeSettings(); });

  // Proxies: the settings panel never owns a control, it presses the real one.
  document.getElementById('settingsPanels')?.addEventListener('click', e => {
    const b = e.target.closest('[data-proxy]');
    if (!b) return;
    document.getElementById(b.dataset.proxy)?.click();
  });
  document.getElementById('settingsHost')?.addEventListener('click', e => {
    const b = e.target.closest('[data-proxy]');
    if (!b) return;
    document.getElementById(b.dataset.proxy)?.click();
  });

  // Remember where the camera picker lives before anything borrows it.
  _camHome = document.getElementById('cameraModeSeg')?.parentElement ?? null;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsOpen()) {
      e.preventDefault(); e.stopPropagation();
      closeSettings();
    }
  }, true);

  // A door you open with a click is a door you close with the same click
  // (Ek, 2026-08-29). Both rails have always toggled; settings was the one
  // opener in the chrome that only ever opened, so a second press did nothing
  // and you had to find Esc or the ✕.
  document.getElementById('tcSettings')?.addEventListener('click', () => {
    if (settingsOpen()) closeSettings(); else openSettings();
  });
  S._openSettings = openSettings;
}
