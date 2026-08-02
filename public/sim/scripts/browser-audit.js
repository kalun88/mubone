// ============================================================================
// browser-audit.js — browser-mode smoke + degradation harness
//
// Companion to ui-shots.js (which covers layout only). This one loads
// index.html in headless Chromium with NO electronBridge and checks the things
// that only break in the browser build:
//
//   • module load — page errors, console errors, 404s, missing js/ files
//   • degradation — Electron-only controls are present, disabled, and labelled
//                   (not silently absent, and not dead-but-enabled)
//   • origin gating — a hosted origin must not spray local-bridge connection
//                     errors into a first-time visitor's console
//   • service worker — a redeploy reaches a returning visitor even without a
//                      CACHE_VERSION bump, and the app still loads offline
//
// The SW checks run against 127.0.0.2 on purpose: index.html skips SW
// registration on localhost/127.0.0.1, but 127.0.0.2 is still loopback, so
// Chromium treats it as a secure context and the worker registers. That gives
// a hosted-origin simulation without needing TLS.
//
// Setup (once per machine/sandbox) — same as ui-shots.js:
//   npm install playwright-core
//   npx playwright-core install chromium-headless-shell
//   # sandboxes without libXdamage.so.1: compile a stub (recipe in ui-shots.js)
//
// Run (starts its own server):
//   node scripts/browser-audit.js
//
// Sections can be run individually with AUDIT_ONLY — useful when iterating, and
// necessary on memory-constrained machines, where launching Chromium for the
// `sw` section after four earlier contexts can get the process OOM-killed:
//   AUDIT_ONLY=shell,origins,boot,reset node scripts/browser-audit.js
//   AUDIT_ONLY=sw                       node scripts/browser-audit.js
//
// Nothing here writes to the working tree. The redeploy test needs to mutate a
// file mid-run, so it does that against a throwaway mirror under os.tmpdir().
//
// Limits: no audio device, no mic, no sensor. Module wiring + UI state only.
// ============================================================================

const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8137;

// ── Static server with the same COOP/COEP headers as serve.py and _headers ──
// (SharedArrayBuffer, and therefore the grain worklet, needs cross-origin
// isolation — serving without these would fail for the wrong reason.)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };

function serve(root, port) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(port, '0.0.0.0', () => r(srv)));
}

const uniq = a => [...new Set(a)];
let FAILURES = 0;
function check(ok, label, detail) {
  if (!ok) FAILURES++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
}

// ── 1. APP_SHELL completeness (static, no browser needed) ──────────────────
function checkAppShell() {
  console.log('\n── service-worker APP_SHELL ──');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map(m => m[1]));
  const onDisk = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(f => f.endsWith('.js')).map(f => 'js/' + f);
  const missing = onDisk.filter(f => !listed.has(f));
  check(missing.length === 0, 'every js/ module is in APP_SHELL', missing.join(', '));

  const pkgV = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const cacheV = sw.match(/CACHE_VERSION\s*=\s*'mubone-([^']+)'/)?.[1];
  check(cacheV === pkgV, 'CACHE_VERSION matches package.json', `sw=${cacheV} pkg=${pkgV}`);

  // The worker must never run in Electron. A file:// URL has an EMPTY
  // hostname, so any gate written in terms of hostname alone lets the desktop
  // app register the worker, which then shadows the packaged app with the
  // browser build's cache. Gate on protocol.
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const reg = idxSrc.slice(Math.max(0, idxSrc.indexOf('serviceWorker')));
  check(/location\.protocol/.test(reg.slice(0, 2000)),
    'SW registration gates on location.protocol (not hostname alone)');
  check(/protocol !== 'http:'/.test(sw),
    'sw.js fetch handler ignores non-http schemes');
}

// ── 2. Load + degradation, at a given origin ───────────────────────────────
async function auditOrigin(browser, host, { expectBridgeAttempt }) {
  console.log(`\n── ${host} ──`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await ctx.newPage();
  const pageErrs = [], consoleErrs = [], badReqs = [];
  page.on('pageerror', e => pageErrs.push(e.message.split('\n')[0].slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  page.on('response', r => { if (r.status() >= 400) badReqs.push(`${r.url()} ${r.status()}`); });

  await page.goto(`http://${host}:${PORT}/index.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const ui = await page.evaluate(async () => {
    const g = id => document.getElementById(id);
    const shown = el => !!el && getComputedStyle(el).display !== 'none';
    g('imuSetupBtn')?.click();
    await new Promise(r => setTimeout(r, 600));
    const wifiMsg = document.querySelector('#imuSetupDiscovery .imu-setup-empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    document.querySelectorAll('.mu-overlay.open').forEach(m => m.classList.remove('open'));
    g('audioSettingsBtn')?.click();
    await new Promise(r => setTimeout(r, 900));
    return {
      isElectron: !!window.electronBridge?.isElectron,
      sab: typeof SharedArrayBuffer !== 'undefined',
      coi: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      panels: document.querySelectorAll('.device').length,
      modals: document.querySelectorAll('.mu-overlay').length,
      wg: typeof window.wg, acc: typeof window.acc,
      wifiMsg,
      oscStation: g('oscStationInline')?.textContent?.trim() ?? '',
      houseRowShown: shown(g('asHouseSpeakersRow')),
      houseDisabled: g('asHouseSpeakersSel')?.disabled,
      houseNote: g('asHouseSpeakersNote')?.textContent?.trim(),
      mixdownRowShown: shown(g('asStereoMixdownRow')),
      bufDisabled: g('asBufferSize')?.disabled,
      // Tooltips end up in data-title — ui-learn.js harvests `title` and strips it.
      bufTip: !!(g('asBufferSize')?.getAttribute('data-title') || g('asBufferSize')?.title),
      houseTip: !!(g('asHouseSpeakersSel')?.getAttribute('data-title') || g('asHouseSpeakersSel')?.title),
      swRegs: (await navigator.serviceWorker?.getRegistrations?.() ?? []).length,
    };
  });

  check(pageErrs.length === 0, 'no page errors', uniq(pageErrs).join(' | '));
  check(badReqs.length === 0, 'no failed requests', uniq(badReqs).slice(0, 3).join(' | '));
  check(ui.coi && ui.sab, 'cross-origin isolated (SharedArrayBuffer available)');
  check(ui.panels >= 10 && ui.modals >= 12, 'panels + modals present', `${ui.panels} panels, ${ui.modals} modals`);
  check(ui.wg === 'object' && ui.acc === 'object', 'console shortcuts wg + acc exposed');

  // Electron-only controls must be VISIBLE and DISABLED, never silently absent.
  check(ui.houseRowShown, 'house-speakers row visible in browser');
  check(ui.houseDisabled === true, 'house-speakers select disabled in browser');
  check(/desktop app/i.test(ui.houseNote ?? ''), 'house-speakers note explains why', ui.houseNote);
  check(ui.mixdownRowShown, 'stereo-mixdown row visible in browser');
  check(ui.bufDisabled === true && ui.bufTip, 'buffer size disabled, with a tooltip explaining why');
  check(ui.houseTip, 'house-speakers select has a tooltip explaining why it is disabled');
  check(!/\b(port\s*)?7500\b/.test(ui.oscStation), 'OSC line does not advertise a UDP port in browser', ui.oscStation);
  check(ui.wifiMsg.length > 0, 'wifi tab explains the browser situation', ui.wifiMsg.slice(0, 70));

  // A hosted page cannot reach a localhost bridge — attempting it is pure noise.
  const bridgeErrs = consoleErrs.filter(e => /ws:\/\/localhost/.test(e));
  if (expectBridgeAttempt) {
    check(bridgeErrs.length > 0, 'local origin still tries the OSC/proxy bridge');
  } else {
    check(bridgeErrs.length === 0, 'hosted origin does not attempt the local bridge', bridgeErrs.join(' | '));
    check(consoleErrs.length === 0, 'hosted origin console is clean', uniq(consoleErrs).join(' | '));
  }
  await ctx.close();
  return ui;
}

// ── 3. Service worker: redeploy reach + offline ────────────────────────────
// This test needs to mutate a file mid-run to simulate a redeploy. It does that
// against a DISPOSABLE MIRROR of the repo under os.tmpdir(), never the working
// tree — an earlier version edited index.html in place and restored it in a
// `finally`, which is fine until the process is killed, at which point it
// leaves the repo holding a test marker. Never edit the working tree from a
// test.
function mirrorRepo() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'mubone-audit-'));
  const copy = (rel) => {
    const from = path.join(ROOT, rel), to = path.join(dst, rel);
    if (!fs.existsSync(from)) return;
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from)) copy(path.join(rel, e));
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  };
  for (const rel of ['index.html', 'sw.js', 'css', 'js', 'gesture-window.html']) copy(rel);
  return dst;
}

// Runs in its OWN browser instance. The factory-reset audit unregisters a
// service worker mid-navigation, and Chromium keeps some registration state at
// the browser-process level (not per-context), which left this audit's first
// reload hanging when the two shared a browser. A separate instance is cheaper
// than reasoning about that.
async function auditServiceWorker() {
  console.log('\n── service worker (127.0.0.2) ──');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const mirror = mirrorRepo();
  const mirrorPort = PORT + 1;
  const msrv = await serve(mirror, mirrorPort);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const origin = `http://127.0.0.2:${mirrorPort}`;

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);
    const primed = await page.evaluate(() => !!navigator.serviceWorker.controller);
    check(primed, 'service worker takes control on first visit');

    // Simulate a redeploy that forgot to bump CACHE_VERSION — the exact mistake
    // that pinned mubone.org/sim to an old build.
    const idx = path.join(mirror, 'index.html');
    const marker = 'MUBONE-AUDIT-REDEPLOY';
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8')
      .replace(/(<span class="top-bar-version">)[^<]*(<\/span>)/, `$1${marker}$2`));

    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => document.querySelector('.top-bar-version')?.textContent?.trim());
    check(after === marker,
      'redeploy reaches a returning visitor without a CACHE_VERSION bump', `saw "${after}"`);

    // Offline must still work — that is what the cache is for.
    await ctx.setOffline(true);
    const offErrs = [];
    page.on('pageerror', e => offErrs.push(e.message.split('\n')[0].slice(0, 140)));
    await page.reload({ waitUntil: 'load', timeout: 30000 }).catch(e => offErrs.push('reload: ' + e.message.slice(0, 80)));
    await page.waitForTimeout(4000);
    const off = await page.evaluate(() => ({
      panels: document.querySelectorAll('.device').length,
      modals: document.querySelectorAll('.mu-overlay').length,
      wg: typeof window.wg,
    })).catch(() => ({ panels: 0, modals: 0, wg: 'undefined' }));
    check(off.panels >= 10 && off.modals >= 12 && off.wg === 'object',
      'app loads fully offline from cache', JSON.stringify(off));
    check(offErrs.length === 0, 'no page errors offline', uniq(offErrs).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    msrv.close();
    fs.rmSync(mirror, { recursive: true, force: true });
  }
}

// ── 4. Boot: the first thing painted must be the FINAL layout ──────────────
// main.js is a module, so it applies the persisted UI scale, panel order,
// collapse state and projector partition only after the document has painted.
// Before the boot veil (index.html <head> + `html.booting` in style.css) that
// was three visible reflows — the first panel landed at x=1094, then 973, then
// 23. This asserts the user never sees an intermediate position, and that the
// veil always lifts even if main.js dies.
async function auditBoot(browser) {
  console.log('\n── boot (settled-layout-first) ──');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Seed a deliberately NON-default layout, so late application is visible.
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    localStorage.setItem('mubone_uiScale', '1.35');
    for (const d of document.querySelectorAll('.device')) {
      const k = [...d.classList].find(c => c.startsWith('device--'))?.slice(8);
      if (k) localStorage.setItem('mubone_panel_' + k, '1');
    }
  });

  const samples = [];
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'commit' });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const s = await page.evaluate(() => {
      const ml = document.querySelector('.main-layout');
      if (!ml) return null;   // body not parsed this far yet — nothing to say
      const first = document.querySelector('.device');
      return {
        t: Math.round(performance.now()),
        booting: document.documentElement.classList.contains('booting'),
        opacity: getComputedStyle(ml).opacity,
        x: first ? Math.round(first.getBoundingClientRect().x) : null,
        rootFont: getComputedStyle(document.documentElement).fontSize,
      };
    }).catch(() => null);
    if (s) samples.push(s);
    if (s && !s.booting && s.opacity === '1') break;
    await page.waitForTimeout(25);
  }

  const seen = samples.filter(s => parseFloat(s.opacity) > 0.01);   // actually on screen
  const finalX = samples[samples.length - 1]?.x;
  const seenX = [...new Set(seen.map(s => s.x))];

  check(samples.length > 0 && seen.length > 0, 'layout becomes visible');
  check(seenX.length === 1 && seenX[0] === finalX,
    'only the final layout position is ever visible',
    `seen: ${seenX.join(', ')} · final: ${finalX}`);
  check(samples.some(s => s.booting), 'boot veil engages before first paint');
  check(seen[0]?.rootFont === '20.25px',
    'saved UI scale applied before anything is visible', seen[0]?.rootFont);
  await ctx.close();

  // Failsafe — a dead main.js must not leave a blank window.
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx2.route('**/js/main.js', r => r.abort());
  const p2 = await ctx2.newPage();
  await p2.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'commit' });
  await p2.waitForTimeout(5200);
  const st = await p2.evaluate(() => ({
    booting: document.documentElement.classList.contains('booting'),
    opacity: getComputedStyle(document.querySelector('.main-layout')).opacity,
  }));
  check(!st.booting && st.opacity === '1',
    'veil lifts on the failsafe even if main.js never runs', JSON.stringify(st));
  await ctx2.close();
}

// ── 5. Reset: the registry is true, and reset honours the categories ───────
// Since 2026-08-01 the reset dialog offers a checkbox per storage category,
// driven by js/storage-registry.js. That list is the thing most likely to rot —
// the two hand-maintained lists it replaced both did — so the first check here
// is the drift detector: after a real boot, every key in localStorage must be
// registered. If you add a key to a module and not to the registry, this fails.
//
// Then: a partial reset must clear exactly its categories and nothing else, a
// select-all must still reach Cache Storage and the service worker (localStorage
// is not the app's only persistence in browser mode), and the pre-split
// mubone_audio_defaults blob must migrate into its four successor keys.
async function auditReset(browser) {
  console.log('\n── reset ──');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // 127.0.0.3, not .2: still loopback (secure context, so the SW registers)
  // but a DIFFERENT origin from auditServiceWorker. This audit unregisters a
  // worker mid-navigation, and sharing an origin with the SW audit left the
  // registration in a limbo that blocked the next context on that origin.
  const origin = `http://127.0.0.3:${PORT}`;
  const boot = async () => {
    await page.goto(`${origin}/index.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);
  };

  await boot();

  // ── 5a. Registry drift ──
  // A boot exercises every module's persistence path, so anything unregistered
  // shows up here. Uses the app's own detector rather than a copy of the list.
  const orphans = await page.evaluate(async () => {
    const m = await import('./js/storage-registry.js');
    return m.unregisteredKeys();
  });
  check(orphans.length === 0,
    'every stored key is in storage-registry.js',
    orphans.length ? `unregistered: ${orphans.join(', ')} — add them to js/storage-registry.js` : '');

  // The split moved dark mode out of the audio blob and made ui-viz.js the sole
  // owner. If that key stops being written, a migrated bucket silently loses
  // the theme, so assert the remaining owner still writes it.
  const darkOwned = await page.evaluate(() => localStorage.getItem('mubone_darkMode'));
  check(darkOwned !== null, 'ui-viz.js writes mubone_darkMode (sole owner since the blob split)');

  // ── 5b. Pre-split audio blob migrates into its four successor keys ──
  await page.evaluate(() => {
    localStorage.clear();
    // A v1.11-shaped blob: audio fields plus the four concerns that moved out.
    localStorage.setItem('mubone_audio_defaults', JSON.stringify({
      outputGain: -7.5, recLimitSeconds: 42, hfHoldMs: 321,
      seedMode: 'nearest', loopFadeTimeMs: 99,
      vizRmsMax: 0.77, cameraMode: 'surface',
      activePresetIndex: 3,
      darkMode: false, sensor3Cal: { axisMap: { roll: 'gx' } },
      ts: 1,
    }));
  });
  await boot();
  const mig = await page.evaluate(async () => {
    const j = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
    // Modules are scoped, so reach the live shared state through the module
    // registry — a dynamic import returns the same instance main.js is using.
    const { S } = await import('./js/state.js');
    return {
      blob:   j('mubone_audio_defaults'),
      seed:   j('mubone_seed_settings'),
      viz:    j('mubone_viz_calibration'),
      patch:  localStorage.getItem('mubone_active_patch'),
      live:   { seedMode: S.seedMode, loopFadeTimeMs: S.loopFadeTimeMs,
                vizRmsMax: S.vizRmsMax, cameraMode: S.cameraMode,
                activePresetIndex: S.activePresetIndex,
                recLimitSeconds: S.recLimitSeconds, hfHoldMs: S.hfHoldMs },
    };
  });
  check(mig.live.seedMode === 'nearest' && mig.live.loopFadeTimeMs === 99,
    'migration: seed settings survive into S', JSON.stringify(mig.live));
  check(mig.live.vizRmsMax === 0.77 && mig.live.cameraMode === 'surface',
    'migration: viz calibration survives into S');
  check(mig.live.activePresetIndex === 3, 'migration: active patch survives into S');
  check(mig.live.recLimitSeconds === 42 && mig.live.hfHoldMs === 321,
    'migration: audio fields that did not move are untouched');
  check(mig.seed?.seedMode === 'nearest' && mig.viz?.vizRmsMax === 0.77 && mig.patch === '3',
    'migration: values landed in the new keys',
    `seed=${!!mig.seed} viz=${!!mig.viz} patch=${mig.patch}`);
  check(mig.blob && !('seedMode' in mig.blob) && !('vizRmsMax' in mig.blob) &&
        !('activePresetIndex' in mig.blob) && !('sensor3Cal' in mig.blob) &&
        !('darkMode' in mig.blob),
    'migration: moved + dropped fields are stripped from the old blob',
    mig.blob ? Object.keys(mig.blob).join(',') : '(blob gone)');

  // ── 5c. A partial reset clears exactly its categories ──
  const DIRT = {
    'mubone-accessory-a8':     '{"ch":1}',       // accessory
    'mubone-ximu-led-map':     '{"led":1}',      // accessory
    'mubone_user_presets':     '{"slot1":"MY PATCH"}', // patches
    'mubone-sensor-prefs':     '{"x":1}',        // sensor
    'mubone_sensorMappings':   '[{"id":"map_1"}]', // mapping
  };
  await page.evaluate(d => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, DIRT);

  const openReset = async () => {
    await page.evaluate(() => document.getElementById('resetBtn').click());
    await page.waitForTimeout(400);
  };
  await openReset();
  const dialog = await page.evaluate(() => ({
    cats:     [...document.querySelectorAll('.reset-cat input[data-cat]')].map(b => b.dataset.cat),
    hasAll:   !!document.querySelector('.reset-cat input[data-all]'),
    disabled: document.querySelector('.factory-reset-confirm').disabled,
    desc:     document.querySelector('.factory-reset-desc')?.textContent?.trim() ?? '',
    allHint:  document.querySelector('.reset-cat-all')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  }));
  check(dialog.cats.length >= 7 && dialog.hasAll,
    'dialog renders a row per category plus select-all', dialog.cats.join(', '));
  check(dialog.disabled === true, 'confirm is disabled until something is checked');
  check(/offline cache/i.test(dialog.allHint) && /service worker/i.test(dialog.allHint),
    'select-all row says it clears the offline cache + service worker', dialog.allHint.slice(0, 80));

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
    page.evaluate(() => {
      const b = document.querySelector('.reset-cat input[data-cat="accessory"]');
      b.checked = true;
      b.dispatchEvent(new Event('change'));
      document.querySelector('.factory-reset-confirm').click();
    }),
  ]);
  await page.waitForTimeout(5000);

  const partial = await page.evaluate(d => {
    const out = {};
    for (const k of Object.keys(d)) out[k] = localStorage.getItem(k);
    return out;
  }, DIRT);
  check(partial['mubone-accessory-a8'] === null && partial['mubone-ximu-led-map'] === null,
    'partial reset cleared the accessory category');
  check(partial['mubone_user_presets'] === DIRT['mubone_user_presets'] &&
        partial['mubone-sensor-prefs'] === DIRT['mubone-sensor-prefs'] &&
        partial['mubone_sensorMappings'] === DIRT['mubone_sensorMappings'],
    'partial reset left every other category alone',
    Object.entries(partial).filter(([, v]) => v === null).map(([k]) => k).join(', '));

  // ── 5c2. A schema flag must not outlive its guard condition ──
  // Resetting `patches` deletes mubone_preset_layout_v, which gates
  // migratePresetIndices(). Its other two data keys live in `mapping` and `ui`,
  // so dropping the flag while they survive re-runs the #156 old→new index
  // remap over already-remapped pins — silent corruption dressed as a reset.
  // keysFor() withholds the flag in that case; prove it, and prove it does NOT
  // withhold when everything goes together.
  const flag = await page.evaluate(async () => {
    const { keysFor } = await import('./js/storage-registry.js');
    localStorage.setItem('mubone_preset_layout_v', '1');
    localStorage.setItem('mubone_radial_pins', '[{"presetIdx":3}]');   // `mapping`
    localStorage.removeItem('mubone_desktop_morph');
    const withPinsAlive = keysFor(['patches']).includes('mubone_preset_layout_v');
    localStorage.removeItem('mubone_radial_pins');
    const withPinsGone  = keysFor(['patches']).includes('mubone_preset_layout_v');
    localStorage.setItem('mubone_radial_pins', '[{"presetIdx":3}]');
    const withBoth = keysFor(['patches', 'mapping', 'ui']).includes('mubone_preset_layout_v');
    return { withPinsAlive, withPinsGone, withBoth };
  });
  check(flag.withPinsAlive === false,
    'schema flag withheld when the data it guards survives the reset', JSON.stringify(flag));
  check(flag.withPinsGone === true && flag.withBoth === true,
    'schema flag IS cleared once nothing it guards is left', JSON.stringify(flag));

  // ── 5c3. A pre-v4 setup file imports onto an already-split machine ──
  // The regression this guards: applySettingsPayload used to write the payload's
  // keys and let loadAudioDefaults reshape afterwards. On a machine that had
  // already split its own storage the destination keys existed, so the
  // non-clobber guard skipped the write while the strip still emptied the blob —
  // the imported seed settings, viz calibration and active patch vanished. The
  // split now runs on the payload, with overwrite, before anything is written.
  const legacyImport = await page.evaluate(async () => {
    const { splitLegacyAudioBlob, objectStore } = await import('./js/ui-audio-settings.js');
    // This machine is already migrated and holds DIFFERENT values.
    localStorage.setItem('mubone_seed_settings',   JSON.stringify({ seedMode: 'all' }));
    localStorage.setItem('mubone_viz_calibration', JSON.stringify({ vizRmsMax: 0.1 }));
    localStorage.setItem('mubone_active_patch',    '0');
    // A v3 payload: grab-bag blob, none of the successor keys.
    const payload = {
      _magic: 'mubone-setup', _version: 3,
      mubone_audio_defaults: JSON.stringify({
        outputGain: -3, seedMode: 'nearest', vizRmsMax: 0.9, activePresetIndex: 5, darkMode: false,
      }),
    };
    splitLegacyAudioBlob(objectStore(payload), { overwrite: true });
    const blob = JSON.parse(payload.mubone_audio_defaults);
    return {
      seed:  payload.mubone_seed_settings ? JSON.parse(payload.mubone_seed_settings).seedMode : null,
      viz:   payload.mubone_viz_calibration ? JSON.parse(payload.mubone_viz_calibration).vizRmsMax : null,
      patch: payload.mubone_active_patch ?? null,
      blobStripped: !('seedMode' in blob) && !('darkMode' in blob) && !('activePresetIndex' in blob),
      blobKept: blob.outputGain,
    };
  });
  check(legacyImport.seed === 'nearest' && legacyImport.viz === 0.9 && legacyImport.patch === '5',
    'pre-v4 import: the file\'s values win over the local split keys', JSON.stringify(legacyImport));
  check(legacyImport.blobStripped && legacyImport.blobKept === -3,
    'pre-v4 import: blob is reshaped, audio fields survive', JSON.stringify(legacyImport));

  // ── 5c4. Session payload is decoupled from settings (audit § E4) ──
  // A session must carry the resolved patch, not an index into this machine's
  // bank, and must NOT carry settings — the format stopped promising to apply
  // them because a session import can't reload. Exercised through the real
  // builder, since the point is what the file contains.
  const sess = await page.evaluate(async () => {
    const { __testBuildSessionPayload } = await import('./js/ui-export.js');
    const { S, PRESETS } = await import('./js/state.js');
    S.activePresetIndex = 2;
    const p = __testBuildSessionPayload();
    return {
      version:     p._version,
      hasSettings: 'settings' in p,
      patchName:   p.patch?.name ?? null,
      bankName:    PRESETS[2]?.name ?? null,
      patchIndex:  p.patchIndex,
      hasLive:     !!p.live,
      // The patch must be a detached copy — exporting a live reference would
      // let a later edit mutate an already-built payload.
      detached:    p.patch !== PRESETS[2],
    };
  });
  check(sess.version === 5 && sess.hasSettings === false,
    'v5 session carries no settings block', JSON.stringify(sess));
  check(sess.patchName && sess.patchName === sess.bankName && sess.patchIndex === 2,
    'session embeds the resolved patch, not just an index', JSON.stringify(sess));
  check(sess.detached && sess.hasLive,
    'embedded patch is a detached copy, live block still present', JSON.stringify(sess));

  // ── 5d. Select-all is still a true factory reset ──
  // Sentinel: a cache entry that a clean boot would never recreate. Counting
  // caches after the reset proves nothing — the service worker legitimately
  // re-registers and re-caches on the reload, which IS day one. What matters
  // is that the OLD cache contents are gone.
  const before = await page.evaluate(async () => {
    const c = await caches.open('mubone-audit-sentinel');
    await c.put('/__sentinel__', new Response('stale'));
    return {
      keys: Object.keys(localStorage).length,
      caches: (await caches.keys()).length,
      sw: (await navigator.serviceWorker.getRegistrations()).length,
    };
  });
  check(before.keys > 5 && before.caches > 0 && before.sw > 0,
    'state is dirty before the full reset', JSON.stringify(before));

  await openReset();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
    page.evaluate(() => {
      const all = document.querySelector('.reset-cat input[data-all]');
      all.checked = true;
      all.dispatchEvent(new Event('change'));
      document.querySelector('.factory-reset-confirm').click();
    }),
  ]);
  await page.waitForTimeout(5000);

  const after = await page.evaluate(async () => ({
    keys: Object.keys(localStorage),
    cacheNames: await caches.keys(),
    sentinel: !!(await caches.match('/__sentinel__')),
    presets: localStorage.getItem('mubone_user_presets'),
    panels: document.querySelectorAll('.device').length,
    modals: document.querySelectorAll('.mu-overlay').length,
  }));
  check(after.presets === null, 'select-all cleared the patches too', String(after.presets));
  check(!after.sentinel && !after.cacheNames.includes('mubone-audit-sentinel'),
    'pre-reset cache contents are gone', `caches now: ${after.cacheNames.join(', ') || '(none)'}`);
  check(after.panels >= 10 && after.modals >= 12, 'app boots clean after reset',
    `${after.panels} panels, ${after.modals} modals`);
  console.log(`       keys re-written by a clean boot: ${after.keys.length ? after.keys.join(', ') : '(none)'}`);
  await ctx.close();
}

// Run a subset with AUDIT_ONLY, e.g. AUDIT_ONLY=sw,reset node scripts/browser-audit.js
// Sections: shell, origins, boot, reset, sw. Handy when iterating — the full
// run takes a couple of minutes because several sections wait on real loads.
const ONLY = (process.env.AUDIT_ONLY || '').split(',').filter(Boolean);
const want = name => ONLY.length === 0 || ONLY.includes(name);

(async () => {
  if (want('shell')) checkAppShell();
  const srv = await serve(ROOT, PORT);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    if (want('origins')) {
      await auditOrigin(browser, '127.0.0.1', { expectBridgeAttempt: true });
      await auditOrigin(browser, '127.0.0.2', { expectBridgeAttempt: false });
    }
    if (want('boot'))  await auditBoot(browser);
    if (want('reset')) await auditReset(browser);
  } finally {
    await browser.close();
    srv.close();
  }
  // Deliberately AFTER the shared browser is closed: this section launches its
  // own instance (see the note on auditServiceWorker), and holding two
  // Chromiums open at once was enough to get the run OOM-killed on a small
  // sandbox. It is last, so nothing else needs the shared browser by now.
  if (want('sw')) await auditServiceWorker();
  console.log(FAILURES === 0 ? '\nAll browser-mode checks passed.' : `\n${FAILURES} check(s) FAILED.`);
  process.exit(FAILURES === 0 ? 0 : 1);
})();
