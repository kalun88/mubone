// ============================================================================
// tile-layout.js — the screen (#291)
//
// The v3 screen from docs/mockups/brush-model-ui.html: chrome on top, one
// full-bleed sphere, the pinned rail on the right, the palette floating over the
// lower stage, the toolbox in the row beneath it and the footer under that.
//
// It used to be a MODE you could leave — a `rig` pill flipped back to the 1.13
// panel layout, and `body.tile-layout` said which of the two was on. Both are
// gone. There is one screen, so this file no longer has a setter; what is left
// is the borrowing, the chrome wiring and the 5 Hz readout tick.
//
// ── The rig cabinet ────────────────────────────────────────────────────────
// `.top-bar` and `.right-panel` are still in index.html and are permanently
// `display: none`. They are not a view any more: they are the CONTROLS this
// screen writes through. Forty-four of them are named by the engine pages
// (js/tiles.js → PARAM_DEFS; scripts/engine-audit.js § C fails if one goes
// missing), the modal openers are proxied by the settings shell, and three
// nodes are BORROWED out of the cabinet and given back — the audio device and
// the two cursor source pickers below, the commits device by ui-settings.js,
// the camera picker by its view panel.
//
// Chrome controls are PROXIES: they click the real cabinet buttons and read
// state back from S, so there is no second copy of any control to desync
// (the cc-mirror-audit lesson, applied by construction).
// ============================================================================

import { S, perf, axisHeld } from './state.js';
import { initTiles, refreshValues, refreshLensStates, setPropsOpen, propsOpen } from './tiles.js';
import { initPinsRail } from './ui-pins.js';

const LS_PINNED = 'mubone_pinned_rail';

/** The pinned rail is a rail like the others (#259): it overlays the stage
 *  and it can be hidden. Kept in localStorage because whether you want the
 *  arrangement visible is a property of how you work, not of a session. */
export function setPinnedRail(on) {
  document.body.classList.toggle('pinned-open', !!on);
  const pinBtn = document.getElementById('tcPinned');
  pinBtn?.classList.toggle('on', !!on);
  pinBtn?.setAttribute('aria-pressed', on ? 'true' : 'false');
  try { localStorage.setItem(LS_PINNED, on ? '1' : '0'); } catch (_) {}
  window.dispatchEvent(new Event('resize'));
}
export function pinnedRailOn() { return document.body.classList.contains('pinned-open'); }

// ── The three cursor mutes (2026-08-29) ───────────────────────────────────
// The footer used to BORROW the cabinet's azimuth and elevation segments. It
// does not any more: three three-word capsules were most of the strip, and Ek
// reads these as mutes to be hit rather than pickers to be read. The footer
// has its own one-icon-per-axis control (index.html), the segments stay in the
// cabinet as the canonical elements the patch table, MIDI and OSC drive, and
// syncAxisSourceUI in main.js keeps both faces of the same state together.
const AXIS_CYCLE = { tcAzCycle: 'azSource', tcElCycle: 'elSource' };
function _syncAxisCycles() {
  for (const [btnId, key] of Object.entries(AXIS_CYCLE)) {
    const b = document.getElementById(btnId);
    if (!b) continue;
    const v = S[key];
    b.classList.toggle('is-mute', v === 'locked');
    b.classList.toggle('is-map',  v === 'mapped');
    b.setAttribute('aria-label', `${key.replace('Source', '')} — ` +
      (v === 'locked' ? 'muted' : v === 'mapped' ? 'mapped' : 'free'));
  }
  // ⌥ reads the two axes rather than a state of its own — there isn't one (see
  // cursorLocked() in main.js). So locking az and el one at a time from the
  // footer lights the lock exactly as pressing ⌥ does, and the two doors can
  // never show different answers.
  const lock = document.getElementById('tcCursorLock');
  const held = axisHeld(S.azSource) && axisHeld(S.elSource);
  if (lock) {
    lock.classList.toggle('is-mute', held);
    lock.setAttribute('aria-pressed', held ? 'true' : 'false');
    lock.setAttribute('aria-label', held ? 'cursor unlock — free azimuth and elevation'
                                         : 'cursor lock — hold azimuth and elevation');
  }
  // Dry rides the same shape: off / on / auto in the same three slots.
  const dry = document.getElementById('tcDryCycle');
  if (dry) {
    const on = document.querySelector('#apDryEnableSeg [data-dry].active')?.dataset.dry ?? 'off';
    dry.classList.toggle('is-mute', on === 'off');
    dry.classList.toggle('is-map',  on === 'auto');
  }
}
S._syncAxisCycles = _syncAxisCycles;

function _initAxisCycles() {
  // Two states on the CLICK, three in the state (Ek, 2026-09-01: "on off
  // mapped, i think that's too complicated. mapping is another thing which we
  // have built for, in the mapping settings page"). So held ↔ free here, and
  // 'mapped' is arrived at only by targeting a cursor axis in Settings →
  // Mapping, which arms it. Clicking a mapped axis frees it, which is the
  // manual disarm _armCursorAxis deliberately leaves to a human.
  for (const [btnId, key] of Object.entries(AXIS_CYCLE)) {
    document.getElementById(btnId)?.addEventListener('click', () => {
      S._setAxisSource?.(key, axisHeld(S[key]) ? 'sensor' : 'locked');
      _syncAxisCycles();
    });
  }
  document.getElementById('tcCursorLock')?.addEventListener('click', () => {
    S._toggleCursorLock?.();
    _syncAxisCycles();
  });
  // The ` key with a face — same function, every entry point lands on it.
  document.getElementById('tcZeroHeading')?.addEventListener('click', () => S._tareCursor?.());
  // The dry cycle drives the real segment by clicking it, so its own handler
  // does the work and no second copy of the rule exists here.
  document.getElementById('tcDryCycle')?.addEventListener('click', () => {
    const seg = document.getElementById('apDryEnableSeg');
    if (!seg) return;
    const btns = [...seg.querySelectorAll('[data-dry]')];
    const i = btns.findIndex(b => b.classList.contains('active'));
    btns[(i + 1) % btns.length]?.click();
    _syncAxisCycles();
  });
}

// The AUDIO half of the footer: the cabinet's audio device, borrowed whole and
// laid out as a row (#263). Its controls are already mirrors of the audio
// settings modal, so moving the node changes nothing about how they work.
let _audioHome = null;
function _borrowAudioPanel(on) {
  const dev = document.querySelector('.device--audio');
  if (!dev) return;
  if (!_audioHome) _audioHome = dev.parentElement;
  (on ? document.getElementById('tcAudioSlot') : _audioHome)?.appendChild(dev);
}

// ── The footer follows the same rules as a tool's params (#266) ───────────
// Ek's test: "sliders double-clickable to reset, numboxes editable". The
// audio panel was built for the rig view, where neither was true, so the
// behaviour is added here rather than duplicated — one pass over whatever
// the footer is holding, idempotent.
// "gain" was neither descriptive nor accurate (Ek, 2026-08-29): the footer has
// one gain slider and it is the DRY MONITOR's level, sitting next to a master
// that is a different gain entirely. `dry mon` no longer needs a short form —
// the mode is an icon now (#tcDryCycle) and its row is hidden.
const _FOOTER_LABELS = { 'dry mon': 'dry', 'dry gain': 'dry vol', 'in gain': 'in' };
function _wireFooterControls() {
  const root = document.getElementById('tcAudioSlot');
  if (!root || root.dataset.wired) return;
  root.dataset.wired = '1';

  // Shorter words in the strip: the footer is read at a glance and its
  // captions already carry the context ("dry" under AUDIO cannot mean
  // anything else).
  for (const lbl of root.querySelectorAll('.grain-label')) {
    const short = _FOOTER_LABELS[lbl.textContent.trim()];
    if (short) { lbl.dataset.full = lbl.textContent; lbl.textContent = short; }
  }

  // Double-click resets to the element's declared default.
  root.addEventListener('dblclick', e => {
    const el = e.target.closest('[data-default]');
    if (!el || el.tagName !== 'INPUT') return;
    e.preventDefault();
    el.value = el.dataset.default;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Numbers are typeable. The cabinet's boxes are `readonly` because there
  // they were readouts; here they are controls, so the flag comes off and a
  // commit writes through the PAIRED SLIDER — which is what already owns the
  // clamp, the step and the formatting.
  for (const num of root.querySelectorAll('.grain-numbox')) {
    const row = num.closest('.grain-row');
    const slider = row?.querySelector('input[type=range]');
    if (!slider) continue;                       // a readout with no control
    num.readOnly = false;
    // Enter commits and then blurs, and blur commits too — so without a dirty
    // flag the value is committed TWICE, the second time against a `shown`
    // scale the first commit already invalidated (120% landed as 200%).
    let dirty = false;
    num.addEventListener('input', () => { dirty = true; });
    const commit = () => {
      if (!dirty) return;
      dirty = false;
      const n = parseFloat(String(num.value).replace(/[^0-9.+-]/g, ''));
      if (Number.isFinite(n)) {
        // The box may DISPLAY different units from the slider it drives — dry
        // gain reads "50%" for a slider value of 0.5. Rather than hard-code
        // that, the scale is read back off the app's own formatter: whatever
        // it printed for the current value tells us the factor. (Same problem
        // the engine page hit with log-mapped sliders; same rule — never
        // re-derive a mapping that already exists.)
        let v = n;
        const shownNum = parseFloat(String(num.dataset.shown ?? '').replace(/[^0-9.+-]/g, ''));
        const cur = +slider.value;
        if (Number.isFinite(shownNum) && cur !== 0) {
          const factor = shownNum / cur;
          if (Math.abs(factor - 1) > 0.001) v = n / factor;
        }
        const min = +slider.min, max = +slider.max, step = +slider.step || 0.01;
        slider.value = Math.round(Math.max(min, Math.min(max, v)) / step) * step;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        slider.dispatchEvent(new Event('input', { bubbles: true }));   // restore
      }
      num.dataset.shown = num.value;   // the scale moved with the value
    };
    // Remember what the formatter last printed, so `commit` can work out the
    // display scale without knowing which control it is.
    num.dataset.shown = num.value;
    slider.addEventListener('input', () => {
      if (document.activeElement !== num) num.dataset.shown = num.value;
    });
    num.addEventListener('keydown', e => {
      e.stopPropagation();                       // digits are tile keys
      if (e.key === 'Enter') { e.preventDefault(); commit(); num.blur(); }
      if (e.key === 'Escape') {
        dirty = false;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        num.blur();
      }
    });
    num.addEventListener('blur', commit);
  }
}


function _proxyClick(fromId, toId) {
  document.getElementById(fromId)?.addEventListener('click', () => {
    document.getElementById(toId)?.click();
  });
}

/** 5 Hz chrome readouts — a handful of reads and text writes, never in the
 *  render loop (render-path note in CLAUDE.md). */
function tick() {
  // Mute is one icon with two faces now (2026-08-29), at the far right of the
  // footer: the control you reach for mid-set should not have to be read.
  const mute = document.getElementById('tcMute');
  if (mute) {
    mute.classList.toggle('muted', !!S.isMuted);
    mute.setAttribute('aria-pressed', S.isMuted ? 'true' : 'false');
  }
  // ── The two rig pills: ● SUBJECT · slot (round ten, R9/R11) ────────────
  // The subject never changes and the slot is a fixed 40px, because a readout
  // glanced at forty times a set must not change width — both pills used to
  // resize on every 200ms tick. The dot carries the state; the slot carries
  // the detail. One writer per pill, and the sensor pill reads S.rig — the
  // fact main.js resolved — never the rendered text of a hidden footer node.
  // Since 2026-09-09 the readout is a GLYPH with a dot: the detail that was
  // the pill's fixed 42px slot goes into the tooltip, so the box never resizes
  // at all — a 32px glyph is one width by construction. Tooltips live in
  // `data-title` (ui-learn.js moves every `title` there on load), so that is
  // the field written; the untouched original is kept once in `data-tip`.
  const _pill = (el, dotCls, slot) => {
    if (!el) return;
    el.classList.remove('on', 'live', 'found', 'lost');
    if (dotCls) el.classList.add(dotCls);
    const base = el.dataset.tip || (el.dataset.tip = el.getAttribute('data-title') || el.title);
    const cut = base.indexOf(' —');
    const want = slot === '—' || cut < 0 ? base : base.slice(0, cut) + ' · ' + slot + base.slice(cut);
    if (el.getAttribute('data-title') !== want) el.setAttribute('data-title', want);
  };
  {
    const mic = document.getElementById('tcMic');
    const realMic = document.getElementById('micEnableBtn');
    if (mic && realMic) {
      const label = realMic.querySelector('span:last-child')?.textContent ?? '';
      if (S.sourceKind === 'sampler')      _pill(mic, 'on',   'file');
      else if (S.isRecording)              _pill(mic, 'live', 'live');
      else if (/ready/i.test(label))       _pill(mic, 'on',   'mic');
      else                                 _pill(mic, '',     '—');
    }
  }
  {
    // The capsule FOLLOWS the cabinet — N, OSC and the settings page all move
    // the same seg, and the chrome must not be a second source of truth.
    const camBtn = document.getElementById('tcCamBtn');
    const camMenu = document.getElementById('tcCamMenu');
    if (camBtn && camMenu) {
      const on = document.querySelector('#cameraModeSeg button.active')?.dataset.mode;
      // No sensor, no sensor mode (Ek, 2026-09-10): the row takes the
      // unavailable face and no click while S.rig says nothing is up. It
      // stays marked if it was the mode when the sensor left, so the state
      // is still readable; the click comes back with the sensor.
      const sensorUp = !!(S.rig && S.rig.up);
      // THE BUTTON IS THE CURRENT MODE (Ek, 2026-09-13): one glyph, the
      // chrome's own 32px icon, and the choice lives in the menu under it.
      const src = camMenu.querySelector(`[data-cam="${on}"] svg`);
      if (src && camBtn.dataset.shown !== on) {
        camBtn.innerHTML = src.outerHTML;
        camBtn.dataset.shown = on || '';
        camBtn.title = camMenu.querySelector(`[data-cam="${on}"]`)?.dataset.word
          ? `camera — ${camMenu.querySelector(`[data-cam="${on}"]`).dataset.word}` : 'camera';
      }
      for (const row of camMenu.querySelectorAll('[data-cam]')) {
        row.classList.toggle('on', row.dataset.cam === on);
        row.setAttribute('aria-checked', String(row.dataset.cam === on));
        if (row.dataset.cam === 'sensor' && row.disabled === sensorUp) row.disabled = !sensorUp;
      }
    }
    const sens = document.getElementById('tcSensor');
    if (sens) {
      const r = S.rig || {};
      if (r.up) _pill(sens, 'on', (r.cursorVia || '—') + (r.count > 1 ? ' ' + r.count : ''));
      else if (r.lost)  _pill(sens, 'lost',  'lost');
      else if (r.found) _pill(sens, 'found', 'found');
      else              _pill(sens, '',      '—');
    }
  }
  // Redo is live only while the redo stack holds something — the pill greys
  // out the moment a new stroke or erase forks history.
  const redo = document.getElementById('tcRedo');
  if (redo) redo.classList.toggle('tc-dis', (S._redoCount?.() ?? 0) === 0);
  const undoEl = document.getElementById('tcUndo');
  if (undoEl) undoEl.classList.toggle('tc-dis', (S._undoCount?.() ?? 1) === 0);

  // The armed tool, the scratch count and the pin count all said in words what
  // the palette and the pinned rail were already showing (Ek, 2026-08-29). Alt-
  // lock is the one thing here that is live state with nowhere else to appear,
  // so it is all that is left — and it renders nothing when the lock is off.
  //
  // THE RECORDING BUDGET IS THE OTHER ONE (2026-09-13). When the total audio
  // in the live buffers reaches `S.recLimitSeconds` (600 s by default),
  // startLiveRecording REFUSES: the press does nothing, no audio is captured
  // and no mark is laid. Every warning it had — the 80% and 95% steps and the
  // refusal itself — was written to `#vmBuffers`, which lives in `.hud`, and
  // `body .hud { display: none }` has hidden that since the one-screen layout
  // (#291) as "panel-era chrome". So the instrument stopped recording in
  // silence, with nothing anywhere on screen to say so: a 14-minute
  // continuous-play test hit it at about 13.5 minutes and deposited nothing
  // from then on. The thresholds below are the ones ui-samples.js already
  // computes; this only gives them somewhere a performer can see.
  const lim = S.recLimitSeconds || 0;
  const recPct = lim > 0 ? Math.min(1, (perf.recTotalSec || 0) / lim) : 0;
  const fill = document.getElementById('tcRecFill');
  if (fill) {
    const w = (recPct * 100).toFixed(1) + '%';
    if (fill.style.width !== w) fill.style.width = w;
    fill.classList.toggle('warn', recPct >= 0.80 && recPct < 0.95);
    fill.classList.toggle('crit', recPct >= 0.95);
  }
  // …and the number beside it (Ek, 2026-09-14): m:ss RECORDED, which is the
  // one fact the bar cannot give. The bar carries the fraction of the budget,
  // so the pair says how much and how close, never the same thing twice.
  const recNum = document.getElementById('tcRecNum');
  if (recNum) {
    const t = Math.max(0, Math.round(perf.recTotalSec || 0));
    const txt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (recNum.textContent !== txt) recNum.textContent = txt;
    recNum.classList.toggle('warn', recPct >= 0.80 && recPct < 0.95);
    recNum.classList.toggle('crit', recPct >= 0.95);
  }
  const recWrap = document.getElementById('tcRecWrap');
  if (recWrap && lim > 0) {
    const tot = Math.round(lim), t = Math.max(0, Math.round(perf.recTotalSec || 0));
    const mmss = x => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
    const want = `recording memory — ${mmss(t)} of ${mmss(tot)} held in RAM. Sweep clears everything unpinned and empties it; at full, a new take is refused until you do`;
    if (recWrap.title !== want) recWrap.title = want;
  }
  // TEXT ONLY WHEN THERE IS SOMETHING TO DO. The bar carries the level; words
  // appear at the ceiling, where the instrument has actually stopped taking
  // new material and "sweep" is the answer. Alt-lock is a held state and wins
  // the slot while it is on.
  const stat = document.getElementById('tcStats');
  if (stat) {
    const want = S.altLocked ? '<b style="color:var(--accent-lock)">alt locked</b>'
               : recPct >= 1 ? '<b style="color:var(--accent-danger)">rec limit — sweep</b>'
               : '';
    if (stat.innerHTML !== want) stat.innerHTML = want;
  }
  refreshValues();
  // Scope selection is derived from the flags, so externally-driven changes
  // (⇧K, N, S keys, OSC) surface here without a full row rebuild.
  refreshLensStates();
  // Source tiles: class toggles only; also self-heals a channel-count change
  // (device switch) into a rebuild. Meter DRAWING stays on the RAF pass.
  S._refreshSourceTiles?.();
}

export function initTileLayout() {
  if (!document.getElementById('tcBar')) return;

  // Picking a segment sets that state; picking the one already active does
  // nothing, which is what a segmented control means (a button would toggle).
  _proxyClick('tcMute', 'muteBtn');
  _initAxisCycles();
  // ── The two rig pills open the SETTINGS WINDOW ────────────────────────
  // Not the sensor modal, and not a mic toggle (Ek, 2026-08-30: "clicking the
  // sensor pill should open the entire settings window and point to the sensor
  // page. not just loading the sensor modal i don't want competing sources").
  //
  // The modal and the settings page host the same DOM — the shell borrows it —
  // so opening the modal from here put the same controls on screen in a second
  // frame, with its own close button and its own idea of where you were. A
  // pill says "here is the state"; clicking it should take you to the one page
  // that owns it, in the one window that holds every page.
  // ── The camera capsule (2026-09-07) ───────────────────────────────────
  // Built here rather than in the HTML so its labels and titles come from the
  // ONE place they are written — the cabinet's #cameraModeSeg — and a mode
  // added there appears here without a second edit. A click proxies the real
  // button, which is the chrome's rule for every control on this bar.
  const camBtn  = document.getElementById('tcCamBtn');
  const camMenu = document.getElementById('tcCamMenu');
  const camReal = document.getElementById('cameraModeSeg');
  if (camBtn && camMenu && camReal) {
    // BUTTONS with `.grain-seg-btn`, because that is the selector `.seg-pill`
    // styles at chrome density (style.css). Bare spans matched nothing and the
    // three words ran together into one unreadable "steersurfacesensor".
    //
    // Three glyphs, not three words (Ek, 2026-09-09): the pointer that steers,
    // the sphere with an orbit for surface, and the app's own sensor mark —
    // the one #azSourceSeg already uses for "the sensor drives it". The word
    // stays in the title, which is the cabinet's — read from `data-title`,
    // where ui-learn.js has already moved it by the time this runs. A mode
    // added there with no glyph here falls back to its word.
    const CAM_GLYPH = {
      steer:   '<path d="M5.5 4.5 19 10.8l-5.9 1.6-1.6 5.9z"/>',
      // POINT is a trackpad: a soft-edged rectangle, which is the surface you
      // actually put a finger on (Ek, 2026-09-13). The old orbit-and-arrow
      // glyph drew the CAMERA's motion; this draws the thing in your hands.
      surface: '<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="3.2"/>',
      sensor:  '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a5.9 5.9 0 0 0 0 8.4M16.2 7.8a5.9 5.9 0 0 1 0 8.4"/><path d="M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14"/>',
    };
    // The mode's own class rides on the svg: the three glyphs are 13.8, 16.8
    // and 19.8 units wide, so the optical-size factor (`--gk`, style.css) is
    // the GLYPH's and not the button's — without it the camera icon changed
    // size when you changed camera mode.
    const svg = (d, m) => `<svg class="cam-g cam-g--${m}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    // ONE ICON, AND THE CHOICE DROPS DOWN (Ek, 2026-09-13: "for the 3 way
    // selector make the same icon size and design but just 1 icon and when you
    // click it a thing pops down or out and then you can select from the 3
    // options"). The capsule spent three slots of a bar that is glyphs end to
    // end saying one thing; the button now says which mode is on, in the same
    // 32px glyph as every other control, and the menu is where you change it.
    // THE WORD COMES BACK HERE. Three glyphs alone were only learnable from a
    // tooltip; a menu row can afford the noun beside the mark, which is the
    // rail's own row model (mark left, label, state right).
    camMenu.innerHTML = [...camReal.querySelectorAll('button')].map(b => {
      const word = (b.textContent || b.dataset.mode || '').trim();
      return `<button type="button" class="tc-cam-row" role="menuitemradio" aria-checked="false"` +
        ` data-cam="${b.dataset.mode}" data-word="${word.replace(/"/g, '&quot;')}"` +
        ` title="${(b.getAttribute('data-title') || b.title || '').replace(/"/g, '&quot;')}">` +
        (CAM_GLYPH[b.dataset.mode] ? svg(CAM_GLYPH[b.dataset.mode], b.dataset.mode) : '') +
        `<span class="tc-cam-word">${word}</span></button>`;
    }).join('');
    const closeCam = () => {
      camMenu.hidden = true;
      camBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', _camAway, true);
      document.removeEventListener('keydown', _camKey, true);
    };
    const _camAway = e => { if (!e.target.closest('.tc-cam-wrap')) closeCam(); };
    const _camKey  = e => { if (e.key === 'Escape') { e.stopPropagation(); closeCam(); camBtn.focus(); } };
    camBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!camMenu.hidden) { closeCam(); return; }
      camMenu.hidden = false;
      camBtn.setAttribute('aria-expanded', 'true');
      // Captured, so a click anywhere — including the sphere, which paints —
      // shuts the menu before that click does anything else.
      document.addEventListener('pointerdown', _camAway, true);
      document.addEventListener('keydown', _camKey, true);
    });
    camMenu.addEventListener('click', e => {
      const t = e.target.closest('[data-cam]');
      if (!t || t.disabled) return;
      camReal.querySelector(`button[data-mode="${t.dataset.cam}"]`)?.click();
      closeCam();
    });
  }
  document.getElementById('tcSensor')?.addEventListener('click', () => S._openSettings?.('sensors'));
  document.getElementById('tcMic')?.addEventListener('click',    () => S._openSettings?.('audio'));
  document.getElementById('tcUndo')?.addEventListener('click', () => S._dispatchAction?.('undo', 127));
  document.getElementById('tcRedo')?.addEventListener('click', () => S._dispatchAction?.('redo', 127));
  document.getElementById('tcTools')?.addEventListener('click', () => {
    // The pill HIDES; it does not take a grain filter off (#292). Painting
    // through a filter is the whole point of one, and the sheet covers the
    // stage, so getting it out of the way must not cost you the glass. The
    // filter stays legible while hidden — refreshLensStates marks this pill.
    setPropsOpen(!propsOpen());
  });
  // Sweep = clear the scratch layer (Ek's term, 2026-08-25): the panel button
  // already removes exactly the unheld material, so these are pure proxies.
  _proxyClick('tcSweep', 'sessionSweepBtn');
  _proxyClick('tcClear', 'sessionEraseBtn');
  document.getElementById('tcPinned')?.addEventListener('click', () => setPinnedRail(!pinnedRailOn()));
  S._togglePinnedRail = () => setPinnedRail(!pinnedRailOn());   // ⇧Tab (tiles.js)

  // Chrome floats over nothing, but stray mousedowns must not start a trace.
  document.getElementById('tcBar')?.addEventListener('mousedown', e => e.stopPropagation());

  initTiles();
  initPinsRail();
  setInterval(tick, 200);

  // Take what the footer borrows out of the cabinet, and teach it the params'
  // interaction rules. Once, at boot — there is no longer a layout to leave.
  _borrowAudioPanel(true);
  _wireFooterControls();
  window.dispatchEvent(new Event('resize'));   // the canvas just changed size

  // CLOSED at boot unless you left it open (Ek, 2026-09-12: "have the right
  // tool rail (pins) start closed on open unless persisted open. but on
  // factory reset it starts closed") — Reset all wipes the key, so a fresh
  // store boots closed. It booted open until then.
  let pinnedOn = false;
  try { const v = localStorage.getItem(LS_PINNED); if (v !== null) pinnedOn = v === '1'; } catch (_) {}
  setPinnedRail(pinnedOn);
}
