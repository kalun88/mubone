// ── Custom tooltips with learning-mode toggle ─────────────────────────────
// Always uses styled tooltips (suppresses native browser title tooltips).
// Normal mode: 400ms hover delay.  Learn mode: instant (0ms).
// Toggle via the "? learn" button in the top bar.

(function () {
  'use strict';

  const S = window.S || {};
  const STORAGE_KEY = 'mubone-learn-mode';
  const NORMAL_DELAY = 400; // ms

  // Default ON — persists only when user explicitly turns it off
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

  // Also observe dynamically added elements
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
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
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  function show(el) {
    const text = el.getAttribute('data-title');
    if (!text) return;

    currentTarget = el;
    tip.textContent = text;
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
    tip.classList.remove('visible');
    currentTarget = null;
  }

  // ── Delegated hover listeners ──────────────────────────────────────────
  function onPointerOver(e) {
    const el = e.target.closest('[data-title]');
    if (!el) return;
    if (el === currentTarget) return;

    hide(); // clear any pending

    const delay = learnMode ? 0 : NORMAL_DELAY;
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

  function setLearnMode(on) {
    learnMode = on;
    S.learnMode = on;
    btn.classList.toggle('learn-active', on);
    if (!on) hide();
    try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch (_) {}
  }

  // Apply initial state
  setLearnMode(learnMode);

  btn.addEventListener('click', () => setLearnMode(!learnMode));

  // Expose for other modules
  S._setLearnMode = setLearnMode;
})();
