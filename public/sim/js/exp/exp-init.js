// ============================================================================
// exp-init.js — Bootstrap for experimental modules
// Only loaded when ?exp is in the URL.  Add new experiment imports here.
// ============================================================================

import { S } from '../state.js';

export async function initExp() {
  // Mark experimental mode on state so other modules can check at runtime
  S.exp = true;

  // Show a subtle indicator so you know exp mode is on
  const badge = document.createElement('span');
  badge.textContent = 'exp';
  badge.style.cssText = `
    position:fixed; top:4px; left:50%; transform:translateX(-50%);
    font:10px/1 monospace; color:#e8a030; opacity:0.6;
    pointer-events:none; z-index:9999;
  `;
  document.body.appendChild(badge);

  console.log('[exp] experimental mode active');
}
