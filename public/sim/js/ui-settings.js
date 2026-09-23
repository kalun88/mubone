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
  // The tool rail: the same panel as pins', with the rail on the LEFT — the
  // chrome's own tools pill (#tcTools) drawn at the nav's 16 (Ek, 2026-09-23:
  // "tools doesn't have a glyph in the nav bar for settings it should").
  tools:    '<rect x="2.5" y="3.5" width="11" height="9" rx="2"/><path d="M6.5 3.5v9"/>',
  sensors:  '<path d="M8 2.4 13.6 8 8 13.6 2.4 8Z"/>',
  mapping:  '<circle cx="4.2" cy="4.6" r="1.7"/><circle cx="11.8" cy="11.4" r="1.7"/><path d="M5.6 5.9 10.4 10.1"/>',
  feedback: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.5"/>',
  viz:      '<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><circle cx="8" cy="8" r="2.6"/>',
  view:     '<rect x="2" y="3.5" width="12" height="9" rx="2"/><path d="M2 6.6h12"/>',
  keys:     '<rect x="2" y="4.5" width="5" height="7" rx="1"/><rect x="9" y="4.5" width="5" height="7" rx="1"/>',
  buttons:  '<rect x="2.5" y="4" width="11" height="8" rx="2.5"/><circle cx="8" cy="8" r="1.6"/>',
  osc:      '<path d="M3 5h10"/><path d="M3 8h10"/><path d="M3 11h6"/>',
  diag:     '<path d="M2 8h3l2-4 2 8 2-5 1.5 3H14"/>',
  // Two faders at different settings — the engine's tuning, one level in
  // from Audio's own circle.
  audioadv: '<path d="M4 2.5v11M12 2.5v11"/><path d="M2.2 6h3.6M10.2 10.5h3.6"/>',
  session:  '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 5.2v5.3"/><path d="M5.9 8.4 8 10.5l2.1-2.1"/>',
  // Reset: the counter-clockwise hook back to a start, open at the top so it
  // reads as "back to factory" and not as the sweep's broom or a reload.
  reset:    '<path d="M8 3.2a4.8 4.8 0 1 1-4.5 3.2"/><path d="M3.2 2.6v3.9h3.9"/>',
};

// Each section: what it is called, and where its body comes from. `modal` is
// an overlay whose dialog gets borrowed; `panel` is one of ours; `node` is any
// element in the rig view borrowed whole (the commits device — #262).
// `action` is a page-level button the header borrows while the page is open
// (SETTINGS-GUI § 4) — a thing the PAGE does, which is not a row.
// Labels are sentence case: inside this dialog the app runs prose (§ 5), and
// the shell's title is this same string.
// NAV TITLES ARE TITLE CASE (Ek, 2026-09-14: "all words with capital first
// letter please in the settings left side nav titles"). The nav is a list of
// PLACES, and a place has a name — "Audio Advanced" reads as one, "Audio
// advanced" reads as a sentence someone stopped writing. Everything INSIDE a
// page stays sentence case: a row title is prose about a setting, not a name
// (docs/SETTINGS-GUI.md § 5, which now says both).
const SECTIONS = [
  { id: 'audio',     label: 'Audio',        group: 'sound',   modal: 'audioSettingsModal', opener: 'audioSettingsBtn', closer: 'audioSettingsClose', action: 'asTestBtn' },
  // Pins were the rig view's "commits" device. Same node, borrowed — every
  // control in it keeps its id, its listener and its wiring (#262).
  // AUDIO SPLIT IN TWO (Ek, 2026-09-14). Audio is the two questions you open
  // it to answer — which input, which output — and the levels around them;
  // everything that tunes the ENGINE rather than the rig is here. It sits
  // straight after Audio so the pair reads as one subject.
  { id: 'audioadv',  label: 'Advanced',      group: 'sound', panel: 'setPanelAudioAdv', under: 'audio' },
  { id: 'pins',      label: 'Pins',         group: 'sound',   node: 'commitPanel' },
  // TOOLS (Ek, 2026-09-22). The rail is what you reach for mid-phrase; this is
  // everything else a tool does. Under `sound` because a tool is how the
  // instrument sounds, beside Pins, which is what it commits into.
  { id: 'tools',     label: 'Tools',        group: 'sound',   panel: 'setPanelTools' },
  { id: 'sensors',   label: 'Sensors',      group: 'sensor',  modal: 'imuSetupModal', opener: 'imuSetupBtn', closer: 'imuSetupClose' },
  { id: 'mapping',   label: 'Mapping',      group: 'sensor',  modal: 'sensorMappingModal', opener: 'mappingBtn', closer: 'sensorMappingClose', action: 'sensorMappingAddBtn' },
  { id: 'feedback',  label: 'LED Feedback', group: 'sensor',  modal: 'ledModal', opener: 'ximuLedBtn', closer: 'ledClose', action: 'ledResetBtn' },
  { id: 'viz',       label: 'Visuals',      group: 'view',    modal: 'vizModal', opener: 'vizSettingsBtn', closer: 'vizModalClose' },
  { id: 'view',      label: 'Camera + Display', group: 'view', panel: 'setPanelView' },
  { id: 'keys',      label: 'Keys + MIDI',   group: 'control', modal: 'mappingModal', opener: 'keysBtn', closer: 'mappingClose', action: 'keysClearAll' },
  { id: 'buttons',   label: 'Instrument Buttons', group: 'control', panel: 'setPanelButtons' },
  { id: 'diag',      label: 'Diagnostics',  group: 'control', panel: 'setPanelDiag' },
  { id: 'session',   label: 'Export · Import', group: 'control', panel: 'setPanelSession' },
  // RESET IS ITS OWN PAGE (Ek, 2026-09-14). It rode with export and import,
  // which are the two things you do to KEEP work; this is the one that throws
  // it away, and nothing destructive should share a page you open to write a
  // file. Last in the list for the same reason.
  { id: 'reset',     label: 'Reset',        group: 'control', panel: 'setPanelReset' },
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

/** THE TOOLS PAGE BORROWS THE CABINET'S TRIGGER CONTROLS (2026-09-22). Same
 *  rule as the camera picker and the dialog bodies: the real control comes
 *  here, keeps its id, its listener and its live state, and goes home when the
 *  page is put away. Mirroring them would be a second source of truth for
 *  values the gate reads every tick.
 *
 *  A SEG is moved whole. A NUMBER is moved as its slider and its numbox
 *  together, because the pair IS the control — `settings-gui.css` lays them out
 *  as one `.set-ctl--slider` and restyles both into the settings kit. */
const _TOOL_BORROW = [
  // The cursor's falloff (Ek, 2026-09-23): set once, so off the rail's cursor section.
  ['radiusFadeCurveSlider', 'setFadeCurveSlot', 'radiusFadeCurveNum'],
  ['trigStartSeg',     'setTrigStartSlot'],
  ['trigReleaseSeg',   'setTrigReleaseSlot'],
  ['trigRearmSlider',  'setTrigRearmSlot', 'trigRearmNum'],
];
// `min slice` and `dub decay` are NOT in that list: they never had a cabinet
// control. They were drawn straight from state by the tape shape sheet, and
// when that sheet went on 2026-09-22 they had no door at all — so this page
// owns them outright, which is what "a setting with no nav item has no way in"
// asks for. ui-trigger.js binds them beside the cabinet's own.

function _borrowTools(on) {
  for (const [id, slotId, numId] of _TOOL_BORROW) {
    const slot = document.getElementById(slotId);
    if (!slot) continue;
    for (const nodeId of [id, numId]) {
      if (!nodeId) continue;
      const node = document.getElementById(nodeId);
      if (!node) continue;
      if (on) { _borrow(node, `tools: ${nodeId}`); slot.appendChild(node); }
      else _return(node);
    }
  }
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
  if (_open === 'view')  _borrowCamera(false);
  if (_open === 'tools') _borrowTools(false);
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
/** The Camera + Display switches READ the app (2026-09-24). Each one proxies
 *  the real cabinet button on click, so the state is never owned here; it is
 *  re-read on the page's tick because every one of them can also change from
 *  elsewhere — ⇧F, P, the window's own fullscreen control, the projector popup
 *  being closed by hand. Four buttons that said "Toggle" and "Show / hide"
 *  stood here until then: a yes/no is the kit's toggle (SETTINGS-GUI § 3), and
 *  a button whose label has to explain that it flips something is the sign. */
function _syncViewSwitches() {
  const set = (id, on) => { const el = document.getElementById(id); if (el && el.checked !== !!on) el.checked = !!on; };
  set('setViewProjector',  S.projectorMode);
  set('setViewFullscreen', document.body.classList.contains('electron-fullscreen'));
  set('setViewPerfMon',    S.perfMonitorVisible);
  // ui-learn.js is a classic script whose `S` is `window.S || {}` — and
  // nothing sets window.S, so its `S.learnMode` write lands in a private
  // object. Its button's class is the one place the state is visible.
  set('setViewLearn',      document.getElementById('learnModeBtn')?.classList.contains('learn-active'));
}

function _viewStats(on) {
  if (_viewStatTick) { clearInterval(_viewStatTick); _viewStatTick = null; }
  if (!on) return;
  const paint = () => {
    _syncViewSwitches();
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
  if (id === 'view')  _borrowCamera(true);
  if (id === 'tools') _borrowTools(true);
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
    // A SUB-ITEM SITS UNDER ITS PARENT (Ek, 2026-09-14: "audio advanced
    // should be under audio in the settings nav"). `under` names the page it
    // belongs to and the nav indents it, so the pair reads as one subject
    // with a second page rather than two subjects that happen to be
    // adjacent. Its label is just the distinguishing word — "Advanced" under
    // "Audio" says everything "Audio Advanced" did, with less. It keeps its
    // own icon (Ek: "add back a logo for Advanced"): the indent alone says
    // it is a child, and a gap where every other row has a mark read as a
    // missing icon rather than as a hierarchy.
    const sub = sec.under ? ' set-nav-item--sub' : '';
    html += `<button type="button" class="set-nav-item${sub}" data-sec="${sec.id}">${icon}<span>${sec.label}</span></button>`;
  }
  // THE CHEAT SHEET IS A LINK, NOT A SECTION (Ek, 2026-09-16). Settings is the
  // one door, so it is where a player looks for anything the stage cannot
  // tell them — but the manual is a page that LEAVES the app, and a nav row
  // that navigates away must not wear the shape of one that shows a panel.
  // So it is an <a> with the external mark, in its own eyebrow, last. The
  // path is relative on purpose: `manual/` ships beside `js/` in both builds,
  // and Electron's file:// needs the `index.html` spelled out. In Electron the
  // window-open handler (electron-main.js) hands `_blank` to the system
  // browser, so the instrument never navigates mid-show.
  html += `<span class="set-nav-grp">help</span>`
    + `<a class="set-nav-item set-nav-link" href="manual/index.html" target="_blank" rel="noopener">`
    + `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + `<path d="M2.5 3.5h4A1.5 1.5 0 0 1 8 5v8a1.2 1.2 0 0 0-1.2-1.2H2.5Z"/>`
    + `<path d="M13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1.2 1.2 0 0 1 1.2-1.2h4.3Z"/></svg>`
    + `<span>Cheat sheet</span><i class="set-nav-ext" aria-hidden="true">\u2197</i></a>`;
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
  S._settingsOpen = settingsOpen;
  S._setSettingsOpen = on => { if (on) openSettings(); else closeSettings(); };   // `settings` (midi.js)
}
