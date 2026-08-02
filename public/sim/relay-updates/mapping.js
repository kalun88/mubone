// ============================================================================
// mapping.js — button → OSC address assignments
//
// Each button has:
//   • a canonical default address /joycon/<side>/button/<name> used ONLY when
//     no alias is configured (so unmapped buttons stay discoverable in the
//     mubone OSC monitor without doubling traffic on mapped ones)
//   • an optional user-defined ALIAS address (e.g. A → /trace)
//   • an optional alias VALUE to send (e.g. /trace 1)
//   • an aliasMode: 'press' (fire on down only) | 'hold' (down=1, up=0) | 'off'
//
// Emission policy (see app.js handleButtons): if aliasAddr is non-empty AND
// aliasMode !== 'off', the alias replaces the default.  Otherwise the default
// fires.  Never both.
//
// Stored in localStorage under 'mubone-joycon.mapping.v1'.
// ============================================================================

const STORE_KEY = 'mubone-joycon.mapping.v1';

// Canonical button list for Right Joy-Con. Left-specific names included for
// future multi-support; the UI filters by side.
export const BUTTONS = Object.freeze([
  { id: 'a',          label: 'A',          side: 'R' },
  { id: 'b',          label: 'B',          side: 'R' },
  { id: 'x',          label: 'X',          side: 'R' },
  { id: 'y',          label: 'Y',          side: 'R' },
  { id: 'r',          label: 'R',          side: 'R' },
  { id: 'zr',         label: 'ZR',         side: 'R' },
  { id: 'rsr',        label: 'SR (right)', side: 'R' },
  { id: 'rsl',        label: 'SL (right)', side: 'R' },
  { id: 'rightStick', label: 'Stick click',side: 'R' },
  { id: 'plus',       label: '+',          side: 'R' },
  { id: 'home',       label: 'Home',       side: 'R' },
  // Left
  { id: 'up',         label: 'Up',         side: 'L' },
  { id: 'down',       label: 'Down',       side: 'L' },
  { id: 'left',       label: 'Left',       side: 'L' },
  { id: 'right',      label: 'Right',      side: 'L' },
  { id: 'l',          label: 'L',          side: 'L' },
  { id: 'zl',         label: 'ZL',         side: 'L' },
  { id: 'lsr',        label: 'SR (left)',  side: 'L' },
  { id: 'lsl',        label: 'SL (left)',  side: 'L' },
  { id: 'leftStick',  label: 'Stick click',side: 'L' },
  { id: 'minus',      label: '−',          side: 'L' },
  { id: 'capture',    label: 'Capture',    side: 'L' },
]);

const defaultMapping = () => {
  const m = {};
  for (const b of BUTTONS) {
    m[b.id] = { aliasAddr: '', aliasValue: '', aliasMode: 'press' };
    // aliasMode: 'press' (fire on down only) | 'hold' (down=1, up=0) | 'off'
  }
  return m;
};

export class Mapping {
  constructor() {
    this.state = defaultMapping();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Merge into defaults so new buttons added later get safe defaults.
      for (const id in this.state) {
        if (parsed[id]) Object.assign(this.state[id], parsed[id]);
      }
    } catch {
      // ignore; keep defaults
    }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch {}
  }

  reset() {
    this.state = defaultMapping();
    this.save();
  }

  get(id) { return this.state[id]; }

  set(id, patch) {
    if (!this.state[id]) return;
    Object.assign(this.state[id], patch);
    this.save();
  }

  export() { return JSON.parse(JSON.stringify(this.state)); }

  import(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const next = defaultMapping();
    for (const id in next) if (obj[id]) Object.assign(next[id], obj[id]);
    this.state = next;
    this.save();
    return true;
  }
}

// ── Address validation helpers ───────────────────────────────────────────────

export function normalizeAddr(addr) {
  addr = String(addr || '').trim();
  if (!addr) return '';
  if (!addr.startsWith('/')) addr = '/' + addr;
  return addr;
}

export function parseValues(valueStr) {
  // Split on whitespace, parse each token as number if it parses, else string.
  const s = String(valueStr || '').trim();
  if (!s) return [];
  return s.split(/\s+/).map((t) => {
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  });
}
