// ============================================================================
// SERVICE WORKER — offline cache for mubone
// CACHE_VERSION must match the UI version in index.html.
// When you bump the version, bump it here too — that triggers re-cache.
// ============================================================================

const CACHE_VERSION = 'mubone-0.16-alpha';

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/state.js',
  './js/grain.js',
  './js/audio.js',
  './js/audio-features.js',
  './js/renderer.js',
  './js/sphere.js',
  './js/events.js',
  './js/imu-setup.js',
  './js/ui-imu-setup.js',
  './js/sensor-registry.js',
  './js/seed-morph.js',
  './js/midi.js',
  './js/osc.js',
  './js/param-lock.js',
  './js/mobile.js',
  './js/handsfree.js',
  './js/diag.js',
  './js/ui-learn.js',
  './js/ui-export.js',
  './js/ui-samples.js',
  './js/ui-presets.js',
  './js/ui-meters.js',
  './js/ui-audio-settings.js',
  './js/sensor-mapping.js',
  './js/ui-sensor-mapping.js',
  './js/ui-sweep.js',
  './js/ui-trace.js',
  './js/ui-improv.js',
  './js/ui-viz.js',
  './js/ui-patch-table.js',
  './js/worklets/recording-capture.worklet.js',
  './js/worklets/quad-capture.worklet.js',
  './js/worklets/input-meter.worklet.js',
  './js/exp/exp-init.js',
  './js/exp/gesture.js',
  './js/exp/gesture-panel.js',
  './js/exp/gesture-viz.js',
  './gesture-window.html',
];

// — Install: pre-cache the entire app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
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

// — Fetch: cache-first for app shell, network-first for everything else
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // WebSocket requests can't be cached
  if (e.request.url.startsWith('ws')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      // Not in cache — try network, cache the response for next time
      return fetch(e.request).then(response => {
        // Only cache successful same-origin GET requests
        if (response.ok && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
