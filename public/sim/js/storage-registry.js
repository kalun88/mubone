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
// (docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md), and factory reset used
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
  { id: 'bindings',  label: 'key / MIDI / OSC bindings', hint: 'custom key map, MIDI learn, OSC stream config' },
  { id: 'accessory', label: 'accessory',               hint: 'A8 channel config + x-IMU3 LED map' },
  { id: 'mapping',   label: 'mapping modules',         hint: 'sensor mappings' },
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
// one-shot migration has run over other keys. Resetting a flag while the data
// it guards survives re-runs the migration over already-migrated data — silent
// corruption dressed as a reset — so `keysFor()` withholds a flag unless every
// key it guards is going too. `mubone_preset_layout_v` was the case that forced
// this (its three data keys spanned three categories); it and its migration
// went with the patch bank on 2026-09-03, and `mubone_sensor_cal_v` is the one
// flag left.

// ── Retired keys ─────────────────────────────────────────────────────────────
// Written by features that were sunset. Deleted once at boot (main.js →
// purgeRetiredKeys) so a profile that predates the sunset carries nothing
// unregistered, and browser-audit's "every key is registered" check stays
// honest. Add to this list in the same commit that stops writing the key.
export const RETIRED_KEYS = [
  // the patch bank, its table, param locks and cloud morph (2026-09-03, #325)
  'mubone_user_presets', 'mubone_preset_layout_v', 'mubone_active_patch', 'mubone_preset_view',
  'mubone_param_locks', 'mubone_radial_anchors', 'mubone_radial_pins', 'mubone_desktop_morph',
  // read by nothing since their owners were sunset: the perform quick view
  // (#223), the OSC stream and gesture panel (sandbox/sunset-2026-08-28), the
  // HUD scale (no reader anywhere). Dead-weight pass, 2026-09-05.
  'mubone_perform_vis', 'mubone_osc_stream', 'mubone_gesture_panel', 'mubone-hud-scale',
];
export function purgeRetiredKeys() {
  let n = 0;
  try { for (const k of RETIRED_KEYS) if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); n++; } }
  catch (_) {}
  if (n) console.info(`[storage] removed ${n} key(s) of sunset features`);
  return n;
}

export const KEYS = [
  // ── bindings ──
  { key: 'mubone_pinned_rail',       cat: 'ui', note: 'whether the pinned rail is open (tile-layout.js LS_PINNED) — written since #291, unregistered until browser-audit ran on macOS 2026-09-05' },
  { key: 'mubone_tile_order',        cat: 'ui', note: 'tile row order; position is the key — see js/tiles.js' },
  { key: 'mubone_tiles_gone',        cat: 'ui', note: 'factory tools and lenses the player DELETED (2026-09-10) — ids that tileDef / lensAll answer for as if they never existed; a reset of this category brings the originals back' },
  { key: 'mubone_tiles',             cat: 'ui', note: 'per-tile engine presets + custom tile definitions (#224) — a tile is a preset of an engine. Since 2026-09-03 a GRAIN tile persists its edits here whether factory or custom and carries its whole block, and `wet` marks a brush whose knobs keep moving its strokes; other factory tiles keep session-only edits' },
  { key: 'mubone_cycle_off',         cat: 'ui', note: 'tool and lens ids SKIPPED when a palette tile cycles (2026-09-03 evening) — the rail\'s cycle mark; stored as exclusions so new tools are in by default' },
  { key: 'mubone_slots',             cat: 'ui', note: 'the palette\'s three slots, { loop, granular, erase } → tile id (2026-09-03 evening; folded mubone_belt and the mubone_brush_slot / mubone_erase_slot pair, migrated on first load)' },
  // ── the palette (2026-09-11) ──
  { key: 'mubone_palette',           cat: 'ui', note: 'the palette: [{ id, verb }] in strip order, ≤ 9 (tiles.js LS_PALETTE) — position N is what `palette_N`, the key digit and the OSC address name' },
  { key: 'mubone_palette_verbs',     cat: 'ui', guards: ['mubone_palette'],
    note: 'stamp: tiles.js derived each tile\'s verb from the pre-2026-09-11 per-verb bindings once; without it the derivation re-runs over the maps' },
  { key: 'mubone_palette_renumber',  cat: 'bindings', guards: ['mubone_key_map', 'mubone_button_map', 'mubone_midi_map'],
    note: 'stamp: midi.js renumbered the three maps onto today\'s positions once (2026-09-11); re-run over renumbered maps it would shift them again' },
  { key: 'mubone_palette_verbs_collapsed', cat: 'bindings', guards: ['mubone_key_map', 'mubone_button_map', 'mubone_midi_map'],
    note: 'stamp: midi.js collapsed the 27 per-verb palette actions onto the 9 `palette_N` ids once (2026-09-11)' },
  { key: 'mubone_key_map',           cat: 'bindings' },
  { key: 'mubone_button_map',        cat: 'bindings', note: 'the instrument\'s buttons: action → { btn, g }' },
  { key: 'mubone_button_timing',     cat: 'bindings', note: 'long-press and tap window, ms' },
  { key: 'mubone_midi_map',          cat: 'bindings' },
  { key: 'mubone_latency_cal',       cat: 'audio', note: 'the loopback measurements (2026-09-04), keyed input device × output device × rate → { deviceS, measuredS, modelS, at }: the DEVICES\' own share — measured minus what the app added — so the buffer and the cushion can move without measuring again; js/latency.js. The first day\'s total-keyed entries are dropped on load' },
  { key: 'mubone_midi_input',        cat: 'bindings', note: 'last selected MIDI input port' },

  // ── accessory ──
  { key: 'mubone-accessory-a8',      cat: 'accessory' },
  { key: 'mubone-ximu-led-feedback', cat: 'accessory', note: 'LED feedback on/off' },
  { key: 'mubone-ximu-led-map',      cat: 'accessory' },

  // ── mapping ──
  { key: 'mubone_sensorMappings',          cat: 'mapping' },
  { key: 'mubone_mappingTransportGlobal',  cat: 'mapping' },

  // ── audio ──
  { key: 'mubone_audio_defaults',         cat: 'audio' },
  { key: 'mubone_seed_settings',          cat: 'audio', note: 'split out of mubone_audio_defaults 2026-08-01' },
  { key: 'mubone_bufferSize',             cat: 'audio' },
  { key: 'mubone_max_grains',             cat: 'audio', note: 'the grain pool and the glow ring (P2, 2026-09-06): how many grains may sound at once — 256 / 512 / 1024, Settings → Audio' },
  { key: 'mubone_audio_cushion',          cat: 'audio', note: 'the stall cushion in ms (2026-09-04, #333): the output credit window and the input ring\'s target fill; js/audio.js applyAudioCushion' },
  { key: 'mubone_custom_speaker_angles',  cat: 'audio' },

  // ── sensor ──
  { key: 'mubone_sensor_cal',    cat: 'sensor' },
  { key: 'mubone_sensor_cal_v',  cat: 'sensor', guards: ['mubone_sensor_cal'],
    note: 'schema flag — MUST travel with mubone_sensor_cal or the frame→camera migration re-runs on migrated data' },
  { key: 'mubone-sensor-prefs',  cat: 'sensor', note: 'per-serial polarity, roll mute, role' },
  { key: 'mubone_sygaldry_known', cat: 'sensor',
    note: 'per-instrument { ssid, address } keyed by the name the instrument reports; '
        + 'replaced muboneSygaldryAddress / muboneSygaldrySsid, which described only one' },

  // ── ui ──
  { key: 'mubone_uiScale',              cat: 'ui', note: 'also read pre-paint by the boot script in index.html' },
  { key: 'mubone_darkMode',             cat: 'ui' },
  { key: 'mubone_fovDeg',               cat: 'ui' },
  { key: 'mubone_edgeIndicator',        cat: 'ui' },
  { key: 'mubone_edgeIndicatorSize',    cat: 'ui' },
  { key: 'mubone-learn-mode',           cat: 'ui' },
  { key: 'mubone_legend_kinds',         cat: 'ui', note: 'which binding kinds the palette legend draws — { key, button, midi } booleans; the three switches under the keys page\'s column titles (2026-09-12). Factory: key only' },
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
  { prefix: 'mubone_sec_',   cat: 'ui', note: 'per-section collapse state' },
];

// Keys a migration deletes on sight. Listed so the audit doesn't flag them as
// unregistered if it catches a bucket mid-migration — NOT resettable targets,
// and never exported.
export const LEGACY_KEYS = [
  // The rig view's layout state, cleared once at boot in main.js (#291): the
  // panel order, the projector column partition (and its pre-v2 form), and
  // which of the two layouts was on. Nothing writes any of them any more.
  'mubone_projector_layout',
  'mubone_projector_layout_v2',
  'mubone_panel_order',
  'mubone_tile_layout',
];

// Prefixes a migration deletes on sight — same rule as LEGACY_KEYS.
export const LEGACY_PREFIXES = [
  'mubone_panel_',             // per-device collapse state (#291)
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
  const prefixes = [...PREFIXES.map(e => e.prefix), ...LEGACY_PREFIXES];
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
