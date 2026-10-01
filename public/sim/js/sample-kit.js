// ============================================================================
// sample-kit.js — the loaded samples outlive a restart (Ek, 2026-09-30)
//
// A sample is a pad on its own key (sampler.js), and the keys are settings
// that persist — so the samples behind them persist too, as THE KIT, the way
// a drum machine keeps its kit. A piece still carries its samples (piece.js
// writes them into the file), opening a piece makes its samples the kit, and
// a new piece keeps the kit.
//
// The audio is too big for localStorage, so it lives in IndexedDB: one record
// per sample (its audio, written once, keyed by `kitId`) and one manifest
// record (order, names, crops). A change rewrites the manifest and only the
// audio that is new; audio the manifest no longer names is deleted.
//
// Every change to the list reaches `S._kitChanged()` — rebuildSampleListUI
// calls it, which covers load, capture, test sounds, delete, reorder and a
// piece opening; a rename and a crop call it themselves. Debounced.
// ============================================================================

import { S, MAX_SAMPLES } from './state.js';
import { makeTake } from './take.js';
import { hotSwapSample } from './grain-worklet-bridge.js';
import { rebuildSampleListUI } from './ui-samples.js';

const DB_NAME = 'mubone-kit';
const DB_V    = 1;
const AUDIO   = 'audio';      // kitId → { sampleRate, data: Float32Array }
const META    = 'meta';       // 'manifest' → { v, samples: [{ kitId, name, cropStart, cropEnd }] }

let _db = null;
function _open() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_V); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
      if (!db.objectStoreNames.contains(META))  db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  _db.catch(() => { _db = null; });
  return _db;
}
const _done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const _req  = r  => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// TRUE UNTIL THE BOOT LOAD HAS READ THE KIT: main.js draws the empty list
// before the read lands, and a save from that would delete the kit it is
// about to load.
let _loading = true;
let _timer   = 0;

async function _save() {
  const db = await _open();
  for (const s of S.samples) if (s && !s.kitId) s.kitId = crypto.randomUUID();
  const live = S.samples.filter(s => s?.buffer);
  const have = new Set(await _req(db.transaction(AUDIO).objectStore(AUDIO).getAllKeys()));
  const tx = db.transaction([AUDIO, META], 'readwrite');
  const audio = tx.objectStore(AUDIO);
  const want = new Set();
  for (const s of live) {
    want.add(s.kitId);
    // A COPY: the take is shared memory (js/take.js), which IndexedDB cannot
    // clone. Written once per sample; its audio never changes after.
    if (!have.has(s.kitId)) audio.put({ sampleRate: s.buffer.sampleRate, data: new Float32Array(s.buffer.data) }, s.kitId);
  }
  for (const k of have) if (!want.has(k)) audio.delete(k);
  tx.objectStore(META).put({
    v: 1,
    samples: live.map(s => ({ kitId: s.kitId, name: s.name, cropStart: s.cropStart ?? 0, cropEnd: s.cropEnd ?? 1 })),
  }, 'manifest');
  await _done(tx);
}

/** Something about the list changed: save the kit shortly. */
export function kitChanged() {
  if (_loading) return;
  clearTimeout(_timer);
  _timer = setTimeout(() => { _save().catch(e => console.warn('[kit] save failed:', e?.message || e)); }, 400);
}
S._kitChanged = kitChanged;

/** At boot: the kit becomes the loaded samples, unless something is already
 *  loaded (a piece opened first). Each lands on the running engine. */
export async function loadKit() {
  try { return await _loadKit(); }
  finally { _loading = false; }
}
async function _loadKit() {
  let man, recs;
  try {
    const db = await _open();
    man = await _req(db.transaction(META).objectStore(META).get('manifest'));
    if (!man?.samples?.length) return 0;
    const st = db.transaction(AUDIO).objectStore(AUDIO);
    recs = await Promise.all(man.samples.map(m => _req(st.get(m.kitId))));
  } catch (e) { console.warn('[kit] load failed:', e?.message || e); return 0; }
  if (S.samples.length) return 0;
  {
    man.samples.forEach((m, i) => {
      const r = recs[i];
      if (!r?.data || S.samples.length >= MAX_SAMPLES) return;
      const take = makeTake(r.data, r.sampleRate);
      S.samples.push({ buffer: take, name: m.name, duration: take.duration, grainCursor: 0,
                       cropStart: m.cropStart ?? 0, cropEnd: m.cropEnd ?? 1, kitId: m.kitId });
      hotSwapSample(take);
    });
    rebuildSampleListUI();
    S._renderSourceUI?.();
  }
  return S.samples.length;
}
