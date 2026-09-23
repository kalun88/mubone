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
  { id: 'sensor',    label: 'sensor config',           hint: 'roles, axis maps, mount and heading calibration' },
  { id: 'ui',        label: 'UI + layout',             hint: 'scale, theme, FOV, panel order + collapse, viz calibration' },
  { id: 'debug',     label: 'debug flags',             hint: 'OSC trace' },
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
  // diag.js stopped writing a crash snapshot every 5 s long ago and only ever
  // removed the key after that; it was still registered as a live debug key,
  // so the reset page offered to reset a value nothing writes (2026-09-13).
  // One mechanism for a retired key, and this is it.
  'grainDiagSnapshot',
  // The rig view's layout state (#291) — cleared by hand in main.js until
  // 2026-09-16 — the two single-instrument sygaldry keys that a fold-in read
  // once (2026-09-16: the fold-in is gone, every rig has run it), and the
  // sensor-cal schema flag whose two migrations (frame → camera, tareQuat)
  // were deleted the same day.
  'mubone_projector_layout', 'mubone_projector_layout_v2', 'mubone_panel_order', 'mubone_tile_layout',
  'muboneSygaldryAddress', 'muboneSygaldrySsid',
  'mubone_sensor_cal_v',
];
// Prefixes retired the same way — the per-device collapse state of the rig
// view (`mubone_panel_<id>`, #291).
export const RETIRED_PREFIXES = ['mubone_panel_'];
export function purgeRetiredKeys() {
  let n = 0;
  try {
    for (const k of RETIRED_KEYS) if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); n++; }
    for (const k of Object.keys(localStorage)) if (RETIRED_PREFIXES.some(p => k.startsWith(p))) { localStorage.removeItem(k); n++; }
  } catch (_) {}
  if (n) console.info(`[storage] removed ${n} key(s) of sunset features`);
  return n;
}

export const KEYS = [
  // ── bindings ──
  { key: 'mubone_sampler_on',        cat: 'ui', note: "the sampler's park switch, Settings › Tools (2026-09-23): '1' shows its tab and lets the brush ink from a file; absent or '0' — the factory — parks it (js/sampler.js)" },
  { key: 'mubone_pinned_rail',       cat: 'ui', note: 'whether the pinned rail is open (tile-layout.js LS_PINNED) — written since #291, unregistered until browser-audit ran on macOS 2026-09-05' },
  { key: 'mubone_tile_order',        cat: 'ui', note: 'tile row order; position is the key — see js/tiles.js' },
  { key: 'mubone_tiles_gone',        cat: 'ui', note: 'factory tools the player DELETED (2026-09-10) — ids that tileDef answers for as if they never existed; a reset of this category brings the originals back. Lens ids (`wide` · `spot`) are swept out on boot since 2026-09-22 night: there is one lens and it is not deletable' },
  { key: 'mubone_tiles_presets',     cat: 'ui', note: "LEGACY (2026-09-22, one evening). It stamped a one-shot that handed `spray` and `index` their factory numbers; both tiles went with the shape-preset sunset the same night. `initTiles` removes the key on load — listed so a profile still carrying it does not read as unregistered" },
  { key: 'mubone_tiles',             cat: 'ui', note: 'per-tile engine presets + custom tile definitions (#224) — a tile is a preset of an engine. Since 2026-09-03 a GRAIN tile persists its edits here whether factory or custom and carries its whole block, other factory tiles keep session-only edits. (`wet` was a per-tile flag here until 2026-09-22; liveness is decided by HOW paint was made now, and nothing about it is stored on a tile)' },
  { key: 'mubone_voices',            cat: 'ui', note: "named voices per engine — a tool is a SHAPE and a VOICE (Ek, 2026-09-21), and this is the voice half: the block of VOICE_PIDS lifted out of the anonymous one a grain tile used to adopt on first use. `{ v: {id: {name, engine, params}}, sel: {engine: id} }`; `sel` is the one the rail marks. LEGACY: the store shipped for one day under this key, and tiles.js migrates it once INTO `mubone_sounds` (LS_VOICES), where the voices live — listed so a profile still carrying it does not read as unregistered" },
  { key: 'mubone_cycle_off',         cat: 'ui', note: 'tool and lens ids SKIPPED when a palette tile cycles (2026-09-03 evening) — the rail\'s cycle mark; stored as exclusions so new tools are in by default' },
  { key: 'mubone_slots',             cat: 'ui', note: 'the palette\'s three slots, { loop, granular, erase } → tile id (2026-09-03 evening; folded mubone_belt and the mubone_brush_slot / mubone_erase_slot pair, migrated on first load)' },
  // ── the palette (2026-09-11) ──
  { key: 'mubone_recent_pieces',     cat: 'ui', note: 'the File > Open Recent list: up to 8 .mubone paths, most recent first (js/piece.js). Per-machine, like everything else here — the pieces themselves are files' },
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
  { key: 'mubone_settings_sensor', cat: 'ui', note: 'which sensor Settings → Sensor shows (ui-imu-setup.js _SEL_KEY) — unregistered until 2026-09-16' },
  { key: 'mubone-sensor-prefs',  cat: 'sensor', note: 'per-serial axis signs and role' },
  { key: 'mubone_sygaldry_known', cat: 'sensor',
    note: 'per-instrument { ssid, address } keyed by the name the instrument reports; '
        + 'replaced muboneSygaldryAddress / muboneSygaldrySsid, which described only one' },

  // ── ui ──
  { key: 'mubone_uiScale',              cat: 'ui', note: 'also read pre-paint by the boot script in index.html' },
  { key: 'mubone_settings_section',     cat: 'ui', note: 'the settings door reopens on the section last open (ui-settings.js). Unregistered from c425c3e to 1.15: the reset page listed it as an orphan and probe-selftest read the orphan row as reload drift' },
  { key: 'mubone_fovDeg',               cat: 'ui' },
  { key: 'mubone-learn-mode',           cat: 'ui' },
  { key: 'mubone_build',                cat: 'ui', note: 'the service worker CACHE_VERSION the hosted demo last booted on (main.js _wipeOnNewBuild, 2026-09-12): a different one wipes the store and reloads — collaborators open every new build at factory. Electron and localhost never write it' },
  { key: 'mubone_sounds',               cat: 'ui', note: 'the VOICES (tiles.js, 2026-09-21): a sound per engine, each its own block of voice pids — a living preset every unpinned stroke follows' },
  { key: 'mubone_voice_seed',           cat: 'ui', note: 'one-shot stamp: the factory voices have been seeded from the engines\' factory blocks (tiles.js _seedVoices)' },
  { key: 'mubone_voice_names',          cat: 'ui', note: 'the names the player gave voices, by id (tiles.js renameVoice)' },
  { key: 'mubone_hand',                 cat: 'ui', note: 'the tool IN HAND — what the spacebar and a left-click on the sphere play (tiles.js, 2026-09-12); a tool id' },
  { key: 'mubone_hand_verb',            cat: 'ui', note: 'the hand\'s verb, toggle | momentary — the hand tile\'s shape (2026-09-12). Factory: momentary (Ek, evening)' },
  { key: 'mubone_palette_digits',       cat: 'bindings', guards: ['mubone_key_map'], note: 'stamp: the factory strip was dealt once — the list into mubone_palette, the hand, the palette rows of the three maps (midi.js seedPaletteDigitsOnce, 2026-09-12)' },
  { key: 'mubone_legend_kind',          cat: 'ui', note: 'the ONE binding kind the palette tiles wear as their sticker — key | button | midi; the segmented row on the keys page (PALETTE-GUI § 11.4, 2026-09-12). Factory: key. Was mubone_legend_kinds, three booleans, for one afternoon' },
  { key: 'mubone_viz_calibration',      cat: 'ui', note: 'split out of mubone_audio_defaults 2026-08-01' },

  // ── debug ──
  // Excluded from the settings export: a shared setup file shouldn't carry
  // someone else's diagnostic state.
  { key: 'muboneOscTrace',    cat: 'debug' },
];

// Keys written under a generated name. Matched by prefix; the reset dialog and
// the export both scan localStorage for these rather than listing them.
export const PREFIXES = [
  { prefix: 'mubone_sec_',   cat: 'ui', note: 'per-section collapse state' },
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
  // (A retired key is purged at boot — purgeRetiredKeys — so a reset never
  // needs to name one.)

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
  // A retired key or prefix is known: a bucket read between boot and the purge
  // is not drift.
  const known = new Set([...KEYS.map(e => e.key), ...RETIRED_KEYS]);
  const prefixes = [...PREFIXES.map(e => e.prefix), ...RETIRED_PREFIXES];
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
