// ============================================================================
// exp-init.js — Bootstrap for experimental modules
// Only loaded when ?exp is in the URL.  Add new experiment imports here.
// ============================================================================

import { S, DEBUG } from '../state.js';

// ── Module registry ─────────────────────────────────────────────────────────
// Each experimental module exports an init() function.  Add imports below
// and call them from initExp().  If a module fails, the rest still load.

async function safeInit(name, initFn) {
  try {
    await initFn();
    DEBUG && console.log(`[exp] ✓ ${name}`);
  } catch (e) {
    console.warn(`[exp] ✗ ${name}:`, e);
  }
}

export async function initExp() {
  // Mark experimental mode on state so other modules can check at runtime
  S.exp = true;

  // ── Gesture extraction ──────────────────────────────────────────────────
  const { initGesture } = await import('./gesture.js');
  await safeInit('gesture', initGesture);

  // ── Gesture visualization ───────────────────────────────────────────────
  const { initGestureViz } = await import('./gesture-viz.js');
  await safeInit('gesture-viz', initGestureViz);

  // Show a subtle indicator so you know exp mode is on
  const badge = document.createElement('span');
  badge.textContent = 'exp';
  badge.style.cssText = `
    position:fixed; top:4px; left:50%; transform:translateX(-50%);
    font:10px/1 monospace; color:#e8a030; opacity:0.6;
    pointer-events:none; z-index:9999;
  `;
  document.body.appendChild(badge);

  console.log('[exp] experimental modules loaded');
}
