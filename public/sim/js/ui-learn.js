// ── Custom tooltips with learning-mode toggle ─────────────────────────────
// Always uses styled tooltips (suppresses native browser title tooltips).
// Learn OFF: ONE WORD and the shortcut, after a short delay. Learn ON: the
// long text the control carries, the shortcut under it, instantly (Ek,
// 2026-09-24: "a simple one word tooltip when learn is off and include the
// shortcut for that, either the simple version or not"). The word is the
// control's own label where it has one on screen, else the first clause of
// its long text; the shortcut is the registry's (midi.js S._shortcutOf).
// Toggle via the ? in the chrome, left of the cog (#tcLearn), or Settings.

(function () {
  'use strict';

  // THE REAL S, by dynamic import: nothing sets `window.S`, so `window.S || {}`
  // was a private object and every read of it was empty (found 2026-09-24,
  // when the shortcut never arrived). A classic script may `import()`.
  // Relative to THIS script's URL, as a classic script's import() is — so
  // `./state.js`, not `./js/state.js` (which resolved to js/js/ and failed
  // silently on the first try).
  let S = {};
  import('./state.js').then(m => { S = m.S; S.learnMode = learnMode; }).catch(e => console.warn('[learn] state import failed:', e?.message || e));
  // A new key (2026-09-25): learn became ON by default, and every profile
  // had stored `off` under the old one — setLearnMode wrote it at every boot —
  // so reading it would have kept the old default forever. It is dropped here
  // once and listed in RETIRED_KEYS.
  const STORAGE_KEY = 'mubone_learn';
  try { localStorage.removeItem('mubone-learn-mode'); } catch (_) {}
  // THE INDUSTRY TIMING (Ek, 2026-09-24: "it should be faster"). A first tip
  // after 500 ms of rest — the band Figma, Linear and Radix's default sit in,
  // long enough that a pointer passing over the chrome shows nothing — and
  // once one is up, the next control shows at ONCE for as long as the pointer
  // keeps moving between controls (the "skip delay": leave them for more than
  // WARM_MS and the next first tip waits again). macOS menus and every
  // toolbar in a DAW behave this way.
  const NORMAL_DELAY = 500; // ms — the first tip's delay when Learn is off
  const WARM_MS = 400;      // ms — after a tip hides, the next shows instantly
  let warmUntil = 0;

  // DEFAULT ON (Ek, 2026-09-25: "by default have it on", reversing 2026-09-22's
  // default off, now that every parameter says what it is). A factory reset is
  // `localStorage.clear()`, so clearing the key IS the reset and this default
  // decides what comes back. Only an explicit OFF persists as off.
  //
  // Off does not mean no tooltips: it means the one-word tip after the delay
  // (NORMAL_DELAY), out of the way while you play.
  let learnMode = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'off') learnMode = false;
  } catch (_) { /* localStorage unavailable (incognito etc) — stay on */ }

  // ── Custom tooltip element ──────────────────────────────────────────────
  const tip = document.createElement('div');
  tip.className = 'learn-tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  let currentTarget = null;
  let hoverTimer = null;

  // ── On first load, convert all title attrs to data-title ────────────────
  // This permanently suppresses native tooltips.
  document.querySelectorAll('[title]').forEach(el => {
    el.setAttribute('data-title', el.getAttribute('title'));
    el.removeAttribute('title');
  });

  // Also observe dynamically added elements AND attribute changes on existing ones
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      // Handle newly added nodes
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute('title')) {
          node.setAttribute('data-title', node.getAttribute('title'));
          node.removeAttribute('title');
        }
        node.querySelectorAll?.('[title]').forEach(el => {
          el.setAttribute('data-title', el.getAttribute('title'));
          el.removeAttribute('title');
        });
      }
      // Handle title attribute set/changed on existing elements
      if (m.type === 'attributes' && m.attributeName === 'title') {
        const el = m.target;
        if (el.hasAttribute('title')) {
          el.setAttribute('data-title', el.getAttribute('title'));
          el.removeAttribute('title');
        }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });

  // The one word: `data-word` if the control says so; else the label on the
  // control it belongs to (a sheet or tab row's name, a tile's name); else
  // the first clause of the long text — the rig writes `word — explanation`.
  function wordFor(el, long) {
    if (el.dataset.word) return el.dataset.word;
    const row = el.closest('.prow, .mrow');
    const lab = row?.querySelector('.prow-n, .mrow-l')?.textContent?.trim();
    if (lab) return lab;
    const tile = el.matches('.tile, .trow') ? el : null;
    // The shape's own span first: the hand tile's `.tile-nm` holds the shape
    // AND the preset (`tapeverbatim` as one string).
    const nm = (tile?.querySelector('.tile-nm-shape') ?? tile?.querySelector('.tile-nm'))?.textContent?.trim();
    if (nm) return nm;
    let w = long.split(' — ')[0];
    if (w.includes(' · ')) w = w.split(' · ')[0];
    return w.replace(/\s*\([^)]*\)\s*$/, '').trim() || long;
  }
  // Is the word already on screen at the control? A row's own label, a
  // tile's name, a button's text — then the simple tip would only repeat it.
  function wordShown(el, word) {
    const row = el.closest('.prow, .mrow');
    const lab = row?.querySelector('.prow-n, .mrow-l')?.textContent?.trim();
    if (lab && lab === word) return true;
    const own = (el.matches('.tile, .trow') ? el : el.closest('.tile, .trow'))?.textContent ?? el.textContent ?? '';
    return own.toLowerCase().includes(word.toLowerCase());
  }
  function show(el) {
    const long = el.getAttribute('data-title');
    if (!long) return;
    const keys = S._shortcutOf?.(el)
      // A control outside the registry says its key in its title's last
      // parenthesis — `system mute (M)` — so that is the fallback.
      || (long.match(/\(([^()]{1,14})\)\s*$/)?.[1] ?? '');
    // NOTHING TO SAY (Ek, 2026-09-24: "if the shorter tooltip is obvious from
    // the text in the GUI it's not needed, unless there's a shortcut"): learn
    // off, no input learned, and the word already written at the control.
    if (!learnMode && !keys && wordShown(el, wordFor(el, long))) return;
    // THE DESIGN (2026-09-24): the word, then each input as a KEYCAP — the
    // shape the tiles' own legend draws — so the tip reads like a menu item
    // with its shortcut. Learn on: the long text above, the keycaps under it.
    tip.textContent = '';
    tip.classList.toggle('learn-tooltip--long', learnMode);
    const head = document.createElement('span');
    head.className = 'lt-text';
    head.textContent = learnMode ? long : wordFor(el, long);
    tip.appendChild(head);
    if (keys) {
      const row = document.createElement('span');
      row.className = 'lt-keys';
      for (const k of keys.split(' · ')) {
        const kb = document.createElement('kbd');
        kb.textContent = k;
        row.appendChild(kb);
      }
      tip.appendChild(row);
    }

    currentTarget = el;
    tip.classList.add('visible');

    // Position near the element
    const rect = el.getBoundingClientRect();
    // Measure after content is set
    const tipRect = tip.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.bottom + 6;

    // Keep on screen
    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
    if (top + tipRect.height > window.innerHeight - 4) {
      top = rect.top - tipRect.height - 6;
    }

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hide() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    if (tip.classList.contains('visible')) warmUntil = performance.now() + WARM_MS;
    tip.classList.remove('visible');
    currentTarget = null;
  }

  // ── Delegated hover listeners ──────────────────────────────────────────
  function onPointerOver(e) {
    const el = e.target.closest('[data-title]');
    if (!el) return;
    if (el === currentTarget) return;

    hide(); // clear any pending

    const delay = (learnMode || performance.now() < warmUntil) ? 0 : NORMAL_DELAY;
    if (delay === 0) {
      show(el);
    } else {
      hoverTimer = setTimeout(() => show(el), delay);
    }
  }

  function onPointerOut(e) {
    const el = e.target.closest('[data-title]');
    if (el && el === currentTarget) hide();
    // Also clear pending timer if they left before delay
    if (el) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);

  // ── Toggle ─────────────────────────────────────────────────────────────
  const btn = document.getElementById('learnModeBtn');
  if (!btn) return;
  // THE ? IN THE CHROME (Ek, 2026-09-25: "a question mark glyph to toggle off
  // and on learn mode … make sure it's lit up accordingly"), left of the cog.
  // `#learnModeBtn` stays the state's home in the cabinet — Settings → Camera
  // + Display's switch proxies it — and the chrome button clicks through.
  const chromeBtn = document.getElementById('tcLearn');

  function setLearnMode(on) {
    learnMode = on;
    S.learnMode = on;
    btn.classList.toggle('learn-active', on);
    if (chromeBtn) {
      chromeBtn.classList.toggle('on', on);
      chromeBtn.setAttribute('aria-pressed', String(on));
    }
    if (!on) hide();
    try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch (_) {}
  }

  // Apply initial state
  setLearnMode(learnMode);

  btn.addEventListener('click', () => setLearnMode(!learnMode));
  chromeBtn?.addEventListener('click', () => btn.click());

  // Expose for other modules
})();
