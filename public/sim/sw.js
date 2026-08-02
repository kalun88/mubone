// ============================================================================
// SERVICE WORKER — offline cache for mubone
//
// CACHE_VERSION must match the UI version in index.html — it is part of the
// release checklist in CLAUDE.md. Bumping it drops the previous cache.
//
// Caching strategy (changed 2026-07-31, browser audit):
//   code (html/js/css)  — NETWORK-FIRST, cache as fallback
//   assets (fonts etc.) — CACHE-FIRST
//
// It used to be cache-first for everything, which is wrong for a file set that
// changes every release: once a visitor had the shell cached, the only thing
// that could dislodge it was a CACHE_VERSION bump — and the bump was easy to
// forget (this file sat at 1.10.0-alpha through the whole 1.11 cycle). A stale
// CACHE_VERSION then pins every returning visitor to an old build forever.
// Network-first makes the version string a cache-eviction hint rather than the
// single point of failure: online visitors always get current code, offline
// visitors still get the full app from cache.
// ============================================================================

const CACHE_VERSION = 'mubone-1.12.0-alpha';

// Extensions served network-first. Everything else (fonts, images, audio) is
// cache-first — those are content-addressed by name and rarely change.
const CODE_RE = /\.(html|js|css|mjs)(\?|$)/i;

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './css/fonts/Inter-latin.woff2',
  './js/main.js',
  './js/state.js',
  './js/storage-registry.js',
  './js/scale.js',
  './js/grain.js',
  './js/grain-worklet-bridge.js',
  './js/audio.js',
  './js/audio-features.js',
  './js/renderer.js',
  './js/sphere.js',
  './js/events.js',
  './js/imu-setup.js',
  './js/ximu-settings.js',
  './js/ui-imu-setup.js',
  './js/sensor-registry.js',
  './js/seed-morph.js',
  './js/midi.js',
  './js/osc.js',
  './js/param-lock.js',
  './js/mobile.js',
  './js/handsfree.js',
  './js/diag.js',
  './js/debug-waveform.js',
  './js/paint-ticker.js',
  './js/ui-learn.js',
  './js/ui-export.js',
  './js/ui-samples.js',
  './js/ui-presets.js',
  './js/ui-meters.js',
  './js/ui-audio-settings.js',
  './js/sensor-mapping.js',
  './js/ui-sensor-mapping.js',
  './js/midi-out.js',
  './js/osc-out.js',
  './js/ui-sweep.js',
  './js/ui-trace.js',
  './js/ui-improv.js',
  './js/ui-viz.js',
  './js/ui-patch-table.js',
  './js/ximu-led-feedback.js',
  './js/ui-led-map.js',
  './js/accessory-registry.js',
  './js/ui-accessory.js',
  './js/erase.js',
  './js/panel-drag.js',
  './js/status-publisher.js',
  './js/osc-stream.js',
  './js/ui-posture-map.js',
  './js/worklets/recording-capture.worklet.js',
  './js/worklets/quad-capture.worklet.js',
  './js/worklets/input-meter.worklet.js',
  './js/worklets/grain-engine.worklet.js',
  './js/gesture.js',
  './js/gesture-panel.js',
  './js/gesture-viz.js',
  './js/interp-kernels.js',
  './js/relational-features.js',
  './js/snapshot-engine.js',
  './js/ui-staging.js',
  './gesture-window.html',
];

// — Install: pre-cache the entire app shell
// addAll() is all-or-nothing: one 404 (a module renamed or deleted without
// updating APP_SHELL) would abort the whole install and leave the previous
// worker in place. Cache entries individually so a stale list degrades to a
// missing file rather than a dead service worker.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.all(APP_SHELL.map(url =>
        cache.add(url).catch(err => {
          console.warn('[sw] could not cache', url, '—', err.message);
        })
      )))
      .then(() => self.skipWaiting())
  );
});

// — Activate: delete old caches when version bumps
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// — Fetch: network-first for code, cache-first for everything else
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin http(s) GETs. The scheme check matters: this
  // worker must never touch a file:// load. It used to get registered inside
  // Electron (index.html's old gate let an empty file:// hostname through) and
  // shadowed the packaged desktop app with the browser build's cache.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  const isCode = e.request.mode === 'navigate' || CODE_RE.test(url.pathname);

  if (isCode) {
    // Network-first: always prefer live code, fall back to cache when offline.
    e.respondWith(
      fetch(e.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request).then(cached =>
          // A navigation that misses the cache would otherwise surface as a
          // bare ERR_FAILED. Fall back to the cached shell — for a SPA that is
          // the same document anyway.
          cached || (e.request.mode === 'navigate'
            ? caches.match('./index.html').then(shell => shell || Response.error())
            : Response.error())
        ))
    );
    return;
  }

  // Cache-first for static assets.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
