// ============================================================================
// PARAM LOCK — per-parameter preset bypass
// ============================================================================
// When a parameter is "locked", preset recall skips it (the value holds).
// Direct interaction (UI sliders/numboxes, OSC, MIDI) still works normally.
// Lock state is global (independent of presets) and persisted in localStorage.
// ============================================================================

const STORAGE_KEY = 'mubone_param_locks';

// Set of parameter keys that are currently locked
const _locks = new Set();

// Set of parameter keys that are lockable (whitelist)
const LOCKABLE_KEYS = new Set([
  'searchRadiusDeg',
  'k',
  'recencyN',
  'seedAttack',
  'seedRelease',
  'seedSlotCount',
  'seqSlotCount',
]);

// ── Public API ──────────────────────────────────────────────────────────────

export function isLockable(key) {
  return LOCKABLE_KEYS.has(key);
}

export function isLocked(key) {
  return _locks.has(key);
}

export function setLock(key, locked) {
  if (!LOCKABLE_KEYS.has(key)) return;
  if (locked) _locks.add(key);
  else        _locks.delete(key);
  _persist();
  _notifyListeners(key, locked);
}

export function toggleLock(key) {
  setLock(key, !isLocked(key));
  return isLocked(key);
}

export function getLockedKeys() {
  return new Set(_locks);
}

// ── Persistence ─────────────────────────────────────────────────────────────

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([..._locks]));
  } catch (_) { /* storage full / unavailable */ }
}

export function loadLocks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      _locks.clear();
      for (const k of arr) {
        if (LOCKABLE_KEYS.has(k)) _locks.add(k);
      }
    }
  } catch (_) { /* corrupt data — start clean */ }
}

// ── Change listeners ────────────────────────────────────────────────────────

const _listeners = [];

export function onLockChange(fn) {
  _listeners.push(fn);
}

function _notifyListeners(key, locked) {
  for (const fn of _listeners) {
    try { fn(key, locked); } catch (_) {}
  }
}
