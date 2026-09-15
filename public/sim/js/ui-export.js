// ============================================================================
// UI — SETUP EXPORT / IMPORT
//
// The RIG, and only the rig: audio devices, sensor calibration, key/MIDI/OSC
// bindings, mappings, the tool strip, the layout — everything that lives in
// localStorage, derived from js/storage-registry.js so the list cannot drift.
// One JSON file, for carrying a setup to another machine.
//
// The MUSIC is a document now, not an export (Ek, 2026-09-14: "export and
// import … that's for changing platforms. we won't change platforms, we are
// always in mubone"). It is js/piece.js, it saves as `.mubone`, and it has a
// path — a Save distinct from a Save As. The session half of this file went
// with it, along with every legacy read path it carried: nothing migrates.
// ============================================================================

import { S } from './state.js';
import { saveAllDefaults, splitLegacyAudioBlob, objectStore } from './ui-audio-settings.js';
import { allKeys, allPrefixes, keysFor, CATEGORIES } from './storage-registry.js';
import { savePiece, savePieceAs, openPiece, initPieceBridge } from './piece.js';

// The setup file's version. v4 (2026-08-01) is the shape the reader still
// expects: one flat key map plus a `_prefixed` bucket for generated names.
const EXPORT_VERSION = 14;

const SETUP_MAGIC = 'mubone-setup';

// localStorage keys that form a complete settings export — derived from
// js/storage-registry.js rather than hand-maintained.
//
// The hand-written list this replaces had drifted twice. The 2026-07-15
// export/import audit found 9 keys missing (docs/archive/EXPORT-IMPORT-AUDIT-2026-07.md
// § B) and listed a registry refactor as deliberately deferred; by 2026-08-01
// four more had gone missing — `mubone-accessory-a8` and `mubone-ximu-led-map`
// among them, so a setup export silently carried none of the A8 accessory
// config or the LED map. Deriving from the registry is what stops this
// recurring; scripts/browser-audit.js fails if a live key isn't registered.
//
// `debug` is the one excluded category: a shared setup file has no business
// carrying someone else's diagnostic snapshot or OSC trace flag.
const EXCLUDED_CATEGORIES = ['debug'];
const STATIC_KEYS   = allKeys({ exclude: EXCLUDED_CATEGORIES });
const EXPORT_PREFIXES = allPrefixes({ exclude: EXCLUDED_CATEGORIES });


// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS EXPORT / IMPORT (lightweight, localStorage only)
// ═════════════════════════════════════════════════════════════════════════════

function buildSettingsPayload() {
  const data = {
    _magic:   SETUP_MAGIC,
    _version: EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),
  };
  for (const key of STATIC_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) data[key] = raw;
    } catch (_) {}
  }
  // Keys written under a generated name (panel + section collapse state).
  // One bucket driven by the registry's prefix list, so adding a prefix there
  // is all it takes — v3 and earlier used separate `_panels` / `_sections`
  // objects, which applySettingsPayload still reads.
  const prefixed = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && EXPORT_PREFIXES.some(p => k.startsWith(p))) prefixed[k] = localStorage.getItem(k);
    }
  } catch (_) {}
  if (Object.keys(prefixed).length > 0) data._prefixed = prefixed;
  return data;
}

function exportSettings() {
  // Flush live state → localStorage before reading keys
  saveAllDefaults();
  const json = JSON.stringify(buildSettingsPayload(), null, 2);
  downloadJSON(json, 'mubone-setup');
}

/**
 * Clear every key a setup file governs — all registered categories except
 * `debug`, which never travels in an export.
 *
 * This is what makes `replace` import mode possible: without it an import is a
 * merge, so a file that carries no accessory config leaves yours in place and
 * you end up running a hybrid of two rigs rather than the one in the file.
 * Enumerating what to clear is only safe because storage-registry.js is
 * asserted complete by scripts/browser-audit.js.
 */
function clearGovernedKeys() {
  const cats = CATEGORIES.map(c => c.id).filter(id => !EXCLUDED_CATEGORIES.includes(id));
  let n = 0;
  for (const k of keysFor(cats)) {
    try { localStorage.removeItem(k); n++; } catch (_) {}
  }
  console.log(`[import] replace mode: cleared ${n} key(s) before applying`);
}

function applySettingsPayload(data) {
  // Normalise a pre-v4 payload BEFORE writing anything. Files up to v3 carry
  // the old grab-bag `mubone_audio_defaults` and none of the four keys it was
  // split into; reshaping afterwards silently dropped the imported seed
  // settings, viz calibration and active patch on any machine that had already
  // migrated its own storage. `overwrite: true` because an import is an
  // explicit instruction to take the file's values.
  splitLegacyAudioBlob(objectStore(data), { overwrite: true });

  for (const key of STATIC_KEYS) {
    if (!(key in data)) continue;
    // Values are raw localStorage strings. A hand-edited file with an object
    // here would stringify to "[object Object]" and poison the key — every
    // later JSON.parse of it throws and the module silently falls back to
    // defaults, which looks like the import having done nothing.
    const v = data[key];
    if (typeof v !== 'string') {
      console.warn(`[import] skipping "${key}": expected a string, got ${typeof v}`);
      continue;
    }
    try { localStorage.setItem(key, v); } catch (e) {
      // Quota is the realistic failure. Say so — silently half-applying a
      // setup is worse than a noisy partial.
      console.warn(`[import] could not write "${key}":`, e.message);
    }
  }
  // v4 writes one `_prefixed` bucket; v3 and earlier split it into `_panels`
  // and `_sections`. Read all three and let the prefix check decide what's
  // legitimate — a payload can't smuggle in an arbitrary key this way.
  for (const bucket of [data._prefixed, data._panels, data._sections]) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [k, v] of Object.entries(bucket)) {
      if (!EXPORT_PREFIXES.some(p => k.startsWith(p))) continue;
      try { localStorage.setItem(k, v); } catch (_) {}
    }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function downloadJSON(json, prefix) {
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const now  = new Date();
  const ts   = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const name = `${prefix}-${ts}.json`;
  const a = document.createElement('a');
  a.href     = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return name;
}

function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve({ name: file.name, data: JSON.parse(reader.result) }); }
        catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    input.click();
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// UI INIT
// ═════════════════════════════════════════════════════════════════════════════

export function initExportImport() {
  const exportBtn = document.getElementById('exportSetupBtn');
  const importBtn = document.getElementById('importSetupBtn');

  // These two are the RIG. The rig-vs-music dialog that used to stand in front
  // of them is gone: the music is a document with its own save and open
  // (js/piece.js), so there is nothing left to choose between.
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportSettings();
      exportBtn.classList.add('export-flash');
      setTimeout(() => exportBtn.classList.remove('export-flash'), 600);
    });
  }

  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      try {
        const { name, data } = await pickFile('.json,application/json');

        // Refuse a file from a newer build than this one can read.
        if (typeof data._version === 'number' && data._version > EXPORT_VERSION) {
          throw new Error(`this setup is version ${data._version}; this build reads up to v${EXPORT_VERSION} — update mubone`);
        }
        if (data._magic !== SETUP_MAGIC) {
          // The one thing worth naming, because it is the mistake to make.
          throw new Error(data._magic === 'mubone-session'
            ? 'that is an old session file — sessions are pieces now, and this build does not read them'
            : 'not a mubone setup file');
        }

        // Merge or replace, then apply + reload. Merge is the default because
        // it is the non-destructive one and the usual reason to import is
        // borrowing part of a setup; replace is for "put this rig on this
        // machine", where a leftover local key is a bug.
        showSetupImportDialog(name, data);
      } catch (e) {
        if (e.message !== 'No file selected') alert('Import failed: ' + e.message);
      }
    });
  }

  initPieceKeys();
  initPieceBridge();
}

/**
 * ⌘S · ⇧⌘S · ⌘O — save, save as, open.
 *
 * Here rather than in events.js because they are the document's, and events.js
 * is the instrument's: every binding there is a single key the performer plays
 * with, and none of them carries a modifier except undo. A held ⌘ means the
 * app, not the instrument.
 */
function initPieceKeys() {
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k !== 's' && k !== 'o') return;
    // Never steal the key from a field the performer is typing in.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (k === 'o') pieceAction(openPiece, 'opening');
    else pieceAction(e.shiftKey ? savePieceAs : savePiece, 'saving');
  });
}

/** Run one document action behind a progress overlay that reports what it did. */
async function pieceAction(fn, verb) {
  if (_pieceBusy) return;
  _pieceBusy = true;
  const overlay = document.createElement('div');
  overlay.className = 'dlg-overlay';
  overlay.innerHTML = `
    <div class="dlg-dialog">
      <div class="dlg-title">${verb}</div>
      <p class="dlg-desc">…</p>
    </div>
  `;
  const desc = () => overlay.querySelector('.dlg-desc');
  let shown = false;
  // A dialog is about to open in front of everything; do not flash an overlay
  // behind it for the 40 ms before the performer has even chosen a file.
  const show = setTimeout(() => { document.body.appendChild(overlay); shown = true; }, 400);
  try {
    const r = await fn((status) => { if (shown) desc().textContent = status; });
    clearTimeout(show);
    if (shown) overlay.remove();
    if (r) S._flashDoc?.(verb === 'saving' ? 'saved' : 'opened');
  } catch (err) {
    clearTimeout(show);
    if (!shown) { document.body.appendChild(overlay); shown = true; }
    overlay.querySelector('.dlg-title').textContent = `${verb} failed`;
    desc().textContent = err.message;
    setTimeout(() => overlay.remove(), 4000);
  } finally {
    _pieceBusy = false;
  }
}

let _pieceBusy = false;

/**
 * Setup import — choose merge or replace before anything is written.
 *
 * The count in the copy is the honest version of the difference: a merge leaves
 * whatever the file doesn't mention, and how many keys that is depends on the
 * file, so it's worth showing rather than describing.
 */
function showSetupImportDialog(name, data) {
  const inFile = allKeys({ exclude: EXCLUDED_CATEGORIES }).filter(k => k in data).length;
  const governed = CATEGORIES.map(c => c.id)
    .filter(id => !EXCLUDED_CATEGORIES.includes(id));
  const localCount = keysFor(governed).filter(k => {
    try { return localStorage.getItem(k) !== null; } catch (_) { return false; }
  }).length;
  const untouched = Math.max(0, localCount - inFile);

  const overlay = document.createElement('div');
  overlay.className = 'dlg-overlay';
  overlay.innerHTML = `
    <div class="dlg-dialog">
      <div class="dlg-title">import settings</div>
      <p class="dlg-desc">
        <strong>${name}</strong> carries ${inFile} setting group(s).
      </p>
      <div class="reset-cats">
        <label class="reset-cat">
          <input type="radio" name="importMode" value="merge" checked>
          <span class="reset-cat-text">
            <span class="reset-cat-label">merge</span>
            <span class="reset-cat-hint">apply what the file has; leave your other ${untouched} setting(s) alone</span>
          </span>
        </label>
        <label class="reset-cat">
          <input type="radio" name="importMode" value="replace">
          <span class="reset-cat-text">
            <span class="reset-cat-label">replace</span>
            <span class="reset-cat-hint">clear all stored settings first, so you get exactly this file's rig</span>
          </span>
        </label>
      </div>
      <div class="dlg-btns">
        <button class="dlg-btn dlg-cancel">cancel</button>
        <button class="dlg-btn dlg-go">import</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.dlg-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.dlg-go').addEventListener('click', () => {
    const replace = overlay.querySelector('input[value="replace"]').checked;
    overlay.remove();
    if (replace) clearGovernedKeys();
    applySettingsPayload(data);
    showReloadDialog(
      `${replace ? 'Replaced' : 'Merged'} settings from <strong>${name}</strong>.`);
  });
}

function showReloadDialog(html) {
  const overlay = document.createElement('div');
  overlay.className = 'dlg-overlay';
  overlay.innerHTML = `
    <div class="dlg-dialog">
      <div class="dlg-title">imported</div>
      <p class="dlg-desc">${html}<br><br>The page will reload to apply changes.</p>
      <div class="dlg-btns">
        <button class="dlg-btn dlg-go">reload</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.dlg-go').addEventListener('click', () => location.reload());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) location.reload(); });
}
