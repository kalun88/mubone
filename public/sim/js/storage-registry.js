// ============================================================================
// STORAGE REGISTRY — the one authoritative map of persisted keys → category
//
// localStorage is the app's ONLY persistence: no IndexedDB, no sessionStorage.
// Every key the app writes must be listed here. Three consumers depend on it:
//
//   1. the reset dialog (main.js)      — checkbox per category
//   2. the settings export (ui-export) — which keys travel in a .json setup
//   3. scripts/browser-audit.js        — asserts nothing unregistered exists
//
// Before this module those were three hand-maintained lists and all three had
// drifted: the export was missing the accessory config and LED map entirely
// (docs/EXPORT-IMPORT-AUDIT-2026-07.md), and factory reset used
// localStorage.clear() specifically to avoid owning a list that would rot.
// One table with an audit assertion behind it is what makes per-category reset
// safe — see `unregisteredKeys()`, which is why the assertion can exist.
//
// ADDING A KEY: add it here in the same commit as the module that writes it.
// browser-audit.js fails otherwise, and the reset dialog will wipe it as an
// unknown (the safe direction, but it won't be individually keepable).
// ============================================================================

// Category order is the order the reset dialog renders them in — roughly
// "most precious first", so the destructive-looking boxes sit at the bottom.
export const CATEGORIES = [
  { id: 'patches',   label: 'patches',                 hint: 'user patch bank + which patch is active' },
  { id: 'bindings',  label: 'key / MIDI / OSC bindings', hint: 'custom key map, MIDI learn, OSC stream config' },
  { id: 'accessory', label: 'accessory',               hint: 'A8 channel config + x-IMU3 LED map' },
  { id: 'mapping',   label: 'mapping modules',         hint: 'sensor mappings, param locks, staging, gesture panel' },
  { id: 'audio',     label: 'audio settings',          hint: 'devices, gains, gate, handsfree, speaker layout, seeds' },
  { id: 'sensor',    label: 'sensor config',           hint: 'roles, axis maps, tare, polarity, roll mute' },
  { id: 'ui',        label: 'UI + layout',             hint: 'scale, theme, FOV, panel order + collapse, viz calibration' },
  { id: 'debug',     label: 'debug flags',             hint: 'grain diag snapshot, OSC trace' },
];

const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id));

// ── The table ───────────────────────────────────────────────────────────────
// `note` is for keys whose ownership isn't obvious from the name.
//
// `guards` marks a SCHEMA FLAG: a key whose only job is to record that a
// one-shot migration has already run over the listed data keys. Deleting a flag
// while its data survives re-runs the migration over already-migrated data,
// which is silent corruption, not a reset — so `keysFor()` withholds a flag
// unless every key it guards is going too. `mubone_preset_layout_v` is the case
// that forced this: it guards migratePresetIndices(), whose three data keys span
// `patches`, `mapping` AND `ui`, so resetting patches alone would have re-run
// the #156 old→new index remap on already-new radial pins and morph endpoints.
export const KEYS = [
  // ── patches ──
  { key: 'mubone_user_presets',      cat: 'patches' },
  { key: 'mubone_preset_layout_v',   cat: 'patches',
    guards: ['mubone_user_presets', 'mubone_radial_pins', 'mubone_desktop_morph'],
    note: 'schema flag gating migratePresetIndices() (state.js) — must travel with the bank on export' },
  { key: 'mubone_active_patch',      cat: 'patches', note: 'split out of mubone_audio_defaults 2026-08-01' },
  { key: 'mubone_preset_view',       cat: 'patches', note: 'patch-table view mode' },

  // ── bindings ──
  { key: 'mubone_key_map',           cat: 'bindings' },
  { key: 'mubone_midi_map',          cat: 'bindings' },
  { key: 'mubone_midi_input',        cat: 'bindings', note: 'last selected MIDI input port' },
  { key: 'mubone_osc_stream',        cat: 'bindings' },

  // ── accessory ──
  { key: 'mubone-accessory-a8',      cat: 'accessory' },
  { key: 'mubone-ximu-led-feedback', cat: 'accessory', note: 'LED feedback on/off' },
  { key: 'mubone-ximu-led-map',      cat: 'accessory' },

  // ── mapping ──
  { key: 'mubone_sensorMappings',          cat: 'mapping' },
  { key: 'mubone_mappingTransportGlobal',  cat: 'mapping' },
  { key: 'mubone_param_locks',             cat: 'mapping' },
  { key: 'mubone_staging',                 cat: 'mapping' },
  { key: 'mubone_gesture_panel',           cat: 'mapping' },
  { key: 'mubone_radial_pins',             cat: 'mapping', note: 'radial morph pins — hold preset indices, see #156 migration' },

  // ── audio ──
  { key: 'mubone_audio_defaults',         cat: 'audio' },
  { key: 'mubone_seed_settings',          cat: 'audio', note: 'split out of mubone_audio_defaults 2026-08-01' },
  { key: 'mubone_bufferSize',             cat: 'audio' },
  { key: 'mubone_custom_speaker_angles',  cat: 'audio' },

  // ── sensor ──
  { key: 'mubone_sensor_cal',    cat: 'sensor' },
  { key: 'mubone_sensor_cal_v',  cat: 'sensor', guards: ['mubone_sensor_cal'],
    note: 'schema flag — MUST travel with mubone_sensor_cal or the frame→camera migration re-runs on migrated data' },
  { key: 'mubone-sensor-prefs',  cat: 'sensor', note: 'per-serial polarity, roll mute, role' },

  // ── ui ──
  { key: 'mubone_uiScale',              cat: 'ui', note: 'also read pre-paint by the boot script in index.html' },
  { key: 'mubone_darkMode',             cat: 'ui' },
  { key: 'mubone-hud-scale',            cat: 'ui' },
  { key: 'mubone_fovDeg',               cat: 'ui' },
  { key: 'mubone_edgeIndicator',        cat: 'ui' },
  { key: 'mubone_edgeIndicatorSize',    cat: 'ui' },
  { key: 'mubone_desktop_morph',        cat: 'ui', note: 'holds preset indices, see #156 migration' },
  { key: 'mubone_panel_order',          cat: 'ui' },
  { key: 'mubone_projector_layout_v2',  cat: 'ui' },
  { key: 'mubone-learn-mode',           cat: 'ui' },
  { key: 'mubone_viz_calibration',      cat: 'ui', note: 'split out of mubone_audio_defaults 2026-08-01' },

  // ── debug ──
  // Excluded from the settings export: a shared setup file shouldn't carry
  // someone else's diagnostic state.
  { key: 'grainDiagSnapshot', cat: 'debug' },
  { key: 'muboneOscTrace',    cat: 'debug' },
];

// Keys written under a generated name. Matched by prefix; the reset dialog and
// the export both scan localStorage for these rather than listing them.
export const PREFIXES = [
  { prefix: 'mubone_panel_', cat: 'ui', note: 'per-panel collapse state (mubone_panel_order is an exact key above)' },
  { prefix: 'mubone_sec_',   cat: 'ui', note: 'per-section collapse state' },
];

// Keys a migration deletes on sight. Listed so the audit doesn't flag them as
// unregistered if it catches a bucket mid-migration — NOT resettable targets,
// and never exported.
export const LEGACY_KEYS = [
  'mubone_projector_layout',   // → _v2 (events.js:1031)
];

// ── Queries ─────────────────────────────────────────────────────────────────

/** Every exact key in the table, optionally filtering by category. */
export function allKeys({ exclude = [] } = {}) {
  const skip = new Set(exclude);
  return KEYS.filter(e => !skip.has(e.cat)).map(e => e.key);
}

/** Prefixes, optionally filtering by category. */
export function allPrefixes({ exclude = [] } = {}) {
  const skip = new Set(exclude);
  return PREFIXES.filter(e => !skip.has(e.cat)).map(e => e.prefix);
}

/**
 * Every key currently in localStorage belonging to one of `cats`.
 * Resolves prefixes against live storage, so it returns exactly what a reset
 * of those categories would delete.
 */
export function keysFor(cats) {
  const want = new Set(cats);
  const out = new Set();
  for (const e of KEYS) if (want.has(e.cat)) out.add(e.key);
  const prefixes = PREFIXES.filter(e => want.has(e.cat)).map(e => e.prefix);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && prefixes.some(p => k.startsWith(p))) out.add(k);
    }
  } catch (_) { /* storage unavailable */ }
  // A legacy key is wiped along with the category its successor belongs to.
  if (want.has('ui')) for (const k of LEGACY_KEYS) out.add(k);

  // Withhold any schema flag whose guarded data isn't all going with it —
  // see the `guards` note on KEYS. Keeping a stale flag is harmless (the
  // migration simply stays skipped); dropping one is not.
  for (const e of KEYS) {
    if (!e.guards || !out.has(e.key)) continue;
    const held = e.guards.filter(g => {
      if (out.has(g)) return false;                 // going too — fine
      try { return localStorage.getItem(g) !== null; } catch (_) { return false; }
    });
    if (held.length) {
      out.delete(e.key);
      console.log(`[storage-registry] keeping ${e.key}: it guards surviving ${held.join(', ')}`);
    }
  }
  return [...out];
}

/**
 * Keys present in localStorage that this table doesn't know about.
 * This is the drift detector: `scripts/browser-audit.js` fails on a non-empty
 * result, and the reset dialog warns so an unlisted key can't quietly become
 * un-keepable. Ignores foreign keys (anything not mubone-namespaced) so a
 * shared origin — or a devtools scratch value — doesn't trip it.
 */
export function unregisteredKeys() {
  const known = new Set([...KEYS.map(e => e.key), ...LEGACY_KEYS]);
  const prefixes = PREFIXES.map(e => e.prefix);
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!/^mubone/i.test(k) && k !== 'grainDiagSnapshot') continue;
      if (known.has(k)) continue;
      if (prefixes.some(p => k.startsWith(p))) continue;
      out.push(k);
    }
  } catch (_) { /* storage unavailable */ }
  return out;
}

// ── Self-check ──────────────────────────────────────────────────────────────
// Runs at import. Catches a typo'd category or a duplicated key at load time
// rather than as a mystery empty checkbox.
(function validate() {
  const seen = new Set();
  for (const e of [...KEYS, ...PREFIXES]) {
    const id = e.key ?? e.prefix;
    if (seen.has(id)) console.warn(`[storage-registry] duplicate entry: ${id}`);
    seen.add(id);
    if (!CATEGORY_IDS.has(e.cat)) console.warn(`[storage-registry] unknown category "${e.cat}" on ${id}`);
  }
  for (const c of CATEGORIES) {
    if (!KEYS.some(e => e.cat === c.id) && !PREFIXES.some(e => e.cat === c.id)) {
      console.warn(`[storage-registry] category "${c.id}" has no keys`);
    }
  }
})();
