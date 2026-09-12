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
//   • origin gating — a hosted origin must not pen local-bridge connection
//                     errors into a first-time visitor's console
//   • service worker — a redeploy reaches a returning visitor even without a
//                      CACHE_VERSION bump, and the app still loads offline
//
// The SW checks run against sw.localhost on purpose: index.html skips SW
// registration on localhost/127.0.0.1, but Chromium resolves *.localhost to loopback
// itself and treats it as a secure context, so the worker registers (see HOSTED). That gives
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

// HOSTED origins, without DNS or extra loopback addresses: Chromium resolves
// any *.localhost name to loopback itself and treats it as a secure context
// (so COOP/COEP hold and the service worker registers), while
// _bridgeReachable() compares the hostname to 'localhost' exactly, so
// demo.localhost reads as HOSTED. The audit used sw.localhost / 127.0.0.3 for
// this, which only Linux routes — on macOS both navigations timed out, so the
// suite had never actually run here (found 2026-09-05).
const HOSTED = 'demo.localhost', HOSTED_RESET = 'reset.localhost';

// The rig cabinet's device panels, by kind (the `device--<kind>` class). Eight
// since #291's sunsets; a panel retired or added changes this list.
// The modals index.html must carry, by id — named rather than counted for the
// reason the comment at the boot check gives. Shared with the reset check,
// which counted to 11 while the list had 7 (2026-09-05).
const MODALS = ['audioSettingsModal', 'vizModal', 'imuSetupModal', 'sensorMappingModal', 'ledModal', 'mappingModal', 'settingsModal'];
const PANELS = ['audio', 'commit', 'erase', 'grain', 'play', 'search', 'session', 'trigger'];

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

  const ui = await page.evaluate(async (MODALS) => {
    const g = id => document.getElementById(id);
    const shown = el => !!el && getComputedStyle(el).display !== 'none';
    g('imuSetupBtn')?.click();
    await new Promise(r => setTimeout(r, 600));
    // The sensors page is one list now (#293) — the per-transport lists and
    // their empty states are gone, and the situational message ("a browser
    // can't open UDP sockets…") lives in the one list's empty state.
    const wifiMsg = document.querySelector('#imuSetupRows .set-empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    document.querySelectorAll('.mu-overlay.open').forEach(m => m.classList.remove('open'));
    g('audioSettingsBtn')?.click();
    await new Promise(r => setTimeout(r, 900));
    return {
      isElectron: !!window.electronBridge?.isElectron,
      sab: typeof SharedArrayBuffer !== 'undefined',
      coi: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      panels: document.querySelectorAll('.device').length,
      panelKinds: [...document.querySelectorAll('.device')].map(d => [...d.classList].find(c => c.startsWith('device--'))?.slice(8)).filter(Boolean).sort(),
      modals: document.querySelectorAll('.mu-overlay').length,
      missingModals: MODALS.filter(id => !document.querySelector('#' + id + '.mu-overlay')),
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
  }, MODALS);

  check(pageErrs.length === 0, 'no page errors', uniq(pageErrs).join(' | '));
  check(badReqs.length === 0, 'no failed requests', uniq(badReqs).slice(0, 3).join(' | '));
  check(ui.coi && ui.sab, 'cross-origin isolated (SharedArrayBuffer available)');
  // The count has to be MAINTAINED, and twice now it has not been: #169
  // deleted cameraModal and left this at 12, and #269's sunset pass took the
  // sample-instrument, gesture, staging and accessory modals and left it at
  // 11. A red harness hides the next real regression, so the eight that are
  // left are named rather than counted — a deletion then says which one.
  // (`.device` panels stay a count: they are the rig cabinet, hidden since
  // #291, and what matters is that the module load did not strand them.)
  // Named since 2026-09-05: the count sat at 10 while the cabinet had 8 (the
  // sunsets took two), so the check was red on a healthy build. A deletion now
  // says which panel, and PANELS is the list to edit in the same commit.
  const missingPanels = PANELS.filter(k => !ui.panelKinds.includes(k));
  check(missingPanels.length === 0, "the cabinet's device panels are all in the DOM", missingPanels.length ? `missing: ${missingPanels.join(', ')}` : `${ui.panels} panels`);
  check(ui.missingModals.length === 0, 'every expected modal is present', ui.missingModals.join(', '));
  check(ui.wg === 'object' && ui.acc === 'object', 'console shortcuts wg + acc exposed');

  // Electron-only controls must be VISIBLE and DISABLED, never silently absent.
  check(ui.houseRowShown, 'house-speakers row visible in browser');
  check(ui.houseDisabled === true, 'house-speakers select disabled in browser');
  check(/desktop app/i.test(ui.houseNote ?? ''), 'house-speakers note explains why', ui.houseNote);
  check(ui.mixdownRowShown, 'stereo-mixdown row visible in browser');
  check(ui.bufDisabled === true && ui.bufTip, 'buffer size disabled, with a tooltip explaining why');
  check(ui.houseTip, 'house-speakers select has a tooltip explaining why it is disabled');
  check(!/\b(port\s*)?7500\b/.test(ui.oscStation), 'OSC line does not advertise a UDP port in browser', ui.oscStation);
  check(ui.wifiMsg.length > 0, 'the sensor list explains the browser situation', ui.wifiMsg.slice(0, 70));

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
  for (const rel of ['index.html', 'sw.js', 'css', 'js']) copy(rel);
  return dst;
}

// Runs in its OWN browser instance. The factory-reset audit unregisters a
// service worker mid-navigation, and Chromium keeps some registration state at
// the browser-process level (not per-context), which left this audit's first
// reload hanging when the two shared a browser. A separate instance is cheaper
// than reasoning about that.
async function auditServiceWorker() {
  console.log('\n── service worker (sw.localhost) ──');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const mirror = mirrorRepo();
  const mirrorPort = PORT + 1;
  const msrv = await serve(mirror, mirrorPort);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const origin = `http://sw.localhost:${mirrorPort}`;

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
    check(off.panels >= PANELS.length && off.modals >= MODALS.length && off.wg === 'object',
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
  // The base root font, read before seeding: the expectation used to be a
  // remembered "20.25px" (15 × 1.35) and went red when the design system
  // moved the root to 16px (21.6). The rule is the RATIO, not a number.
  const baseFont = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
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
  check(seen[0] && Math.abs(parseFloat(seen[0].rootFont) - baseFont * 1.35) < 0.05,
    'saved UI scale applied before anything is visible', `${seen[0]?.rootFont} (base ${baseFont}px × 1.35)`);
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
  // Its own hosted origin, a DIFFERENT one from auditOrigin's: this audit
  // unregisters a worker mid-navigation, and sharing an origin with the SW
  // audit left the registration in a limbo that blocked the next context.
  const origin = `http://${HOSTED_RESET}:${PORT}`;
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
      activePresetIndex: 3,   // the bank's index — sunset 2026-09-03; must be DROPPED, not carried
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
      patch:  localStorage.getItem('mubone_active_patch'),   // retired key — must stay absent
      live:   { seedMode: S.seedMode, loopFadeTimeMs: S.loopFadeTimeMs,
                vizRmsMax: S.vizRmsMax, cameraMode: S.cameraMode,
                recLimitSeconds: S.recLimitSeconds, hfHoldMs: S.hfHoldMs },
    };
  });
  check(mig.live.seedMode === 'nearest' && mig.live.loopFadeTimeMs === 99,
    'migration: seed settings survive into S', JSON.stringify(mig.live));
  check(mig.live.vizRmsMax === 0.77 && mig.live.cameraMode === 'surface',
    'migration: viz calibration survives into S');
  check(mig.patch === null, 'migration: the retired active-patch key is not written');
  check(mig.live.recLimitSeconds === 42 && mig.live.hfHoldMs === 321,
    'migration: audio fields that did not move are untouched');
  check(mig.seed?.seedMode === 'nearest' && mig.viz?.vizRmsMax === 0.77,
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
    'mubone_tile_order':       '["pen"]',      // ui
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
    disabled: document.querySelector('.dlg-go').disabled,
    desc:     document.querySelector('.dlg-desc')?.textContent?.trim() ?? '',
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
      document.querySelector('.dlg-go').click();
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
  check(partial['mubone_tile_order'] === DIRT['mubone_tile_order'] &&
        partial['mubone-sensor-prefs'] === DIRT['mubone-sensor-prefs'] &&
        partial['mubone_sensorMappings'] === DIRT['mubone_sensorMappings'],
    'partial reset left every other category alone',
    Object.entries(partial).filter(([, v]) => v === null).map(([k]) => k).join(', '));

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
  check(legacyImport.seed === 'nearest' && legacyImport.viz === 0.9 && legacyImport.patch === null,
    'pre-v4 import: the file\'s values win over the local split keys, and the bank index is dropped', JSON.stringify(legacyImport));
  check(legacyImport.blobStripped && legacyImport.blobKept === -3,
    'pre-v4 import: blob is reshaped, audio fields survive', JSON.stringify(legacyImport));

  // ── 5c4. Session payload is decoupled from settings (audit § E4) ──
  // A session must carry the sound it was played on as a SNAPSHOT of the live
  // parameter set (v11 — there is no bank to index into any more), and must
  // NOT carry settings — the format stopped promising to apply them because a
  // session import can't reload. Exercised through the real builder, since the
  // point is what the file contains.
  const sess = await page.evaluate(async () => {
    const { __testBuildSessionPayload } = await import('./js/ui-export.js');
    const { S } = await import('./js/state.js');

    // Arm one trigger so the payload has something to serialise. Built through
    // armTrigger for the same reason trigger-audit.js does: creating one needs
    // a painted stroke and a live AudioBuffer, neither of which exists here.
    // Paint a trigger-type stroke and arm it. A trigger is a view onto real
    // particles and a real source buffer, so the fixture has to provide both —
    // there is no way to conjure one from settings alone, which is the property
    // the payload assertions below are checking for.
    const { armTrigger } = await import('./js/trigger.js');
    const { stampCartesian } = await import('./js/grain.js');
    const octx = new OfflineAudioContext(1, 44100, 44100);
    S.liveRecBuffers = [{ buffer: octx.createBuffer(1, 44100, 44100), liveBuffer: null, grainCursor: 0 }];
    S.triggers.length = 0;
    for (let i = 0; i < 3; i++) {
      const p = { lon: i * 0.01, lat: 0, strokeId: 77, source: 'live', liveBufferIdx: 0,
                  grainStart: i * 0.01, grainDuration: 0.01, trig: true };
      stampCartesian(p);
      S.particles.push(p);
    }
    S._particleVersion++;
    Object.assign(S.triggerParams, { rearmMs: 250, dwell: 'loop', start: 'touch' });
    armTrigger(77);

    const p = __testBuildSessionPayload();
    S.triggers.length = 0;
    return {
      version:     p._version,
      hasSettings: 'settings' in p,
      patchIsSnapshot: !!p.patch && typeof p.patch.duration === 'number' && !('name' in p.patch),
      noIndex:     !('patchIndex' in p),
      hasLive:     !!p.live,
      // Triggers ride in the session (material), not the setup (rig).
      trigCount:   Array.isArray(p.triggers) ? p.triggers.length : -1,
      trigDwell:   p.triggers?.[0]?.trigger?.dwell ?? null,
      trigStroke:  p.triggers?.[0]?.strokeId ?? null,
      // How triggers PLAY is global and live, so it rides in the live block —
      // not copied onto each entry, where a mid-set change couldn't reach it.
      trigParamsRearm:  p.live?.triggerParams?.rearmMs ?? null,
      trigParamsDwell:  p.live?.triggerParams?.dwell ?? null,
      trigNoPerEntrySettings: p.triggers?.[0] ? !('trigger' in p.triggers[0]) : false,
      // A trigger is a view onto a stroke, so it must carry NO audio and NO
      // particles of its own — both are already in the payload once. Storing
      // them again would duplicate the audio and let the copies drift, which is
      // the exact shape of the § E9 bug that made loop slots import silent.
      trigNoAudio:     p.triggers?.[0] ? !('wav' in p.triggers[0]) : false,
      trigNoParticles: p.triggers?.[0] ? !('particles' in p.triggers[0]) : false,
      // The type has to travel with the material or a percussion map imports as
      // granulation fodder.
      trigParticleFlagged: (p.particles || []).some(q => q.strokeId === 77 && q.trig === 1),
    };
  });
  const EXPORT_VERSION = Number(fs.readFileSync(path.join(ROOT, 'js', 'ui-export.js'), 'utf8').match(/EXPORT_VERSION = (\d+)/)[1]);
  check(sess.version === EXPORT_VERSION && sess.hasSettings === false,
    `a v${EXPORT_VERSION} session carries no settings block`, JSON.stringify(sess));
  check(sess.patchIsSnapshot && sess.noIndex,
    'session embeds a snapshot of the live sound and no bank index', JSON.stringify(sess));
  check(sess.trigCount === 1 && sess.trigStroke === 77,
    'session carries the triggers as views onto their strokes', JSON.stringify(sess));
  check(sess.trigNoAudio && sess.trigNoParticles && sess.trigNoPerEntrySettings,
    'a trigger serialises as a strokeId alone — no audio, particles or settings', JSON.stringify(sess));
  check(sess.trigParamsRearm === 250 && sess.trigParamsDwell === 'loop',
    'trigger playback params ride in the live block, once for all of them', JSON.stringify(sess));
  check(sess.trigParticleFlagged,
    'trigger-vs-granular type travels with the particles', JSON.stringify(sess));
  check(sess.hasLive, 'live block present', JSON.stringify(sess));

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
      document.querySelector('.dlg-go').click();
    }),
  ]);
  await page.waitForTimeout(5000);

  const after = await page.evaluate(async () => ({
    keys: Object.keys(localStorage),
    cacheNames: await caches.keys(),
    sentinel: !!(await caches.match('/__sentinel__')),
    tiles: localStorage.getItem('mubone_tile_order'),
    panels: document.querySelectorAll('.device').length,
    modals: document.querySelectorAll('.mu-overlay').length,
    modalIds: [...document.querySelectorAll('.mu-overlay')].map(m => m.id),
  }));
  check(after.tiles === null, 'select-all cleared the tile order too', String(after.tiles));
  check(!after.sentinel && !after.cacheNames.includes('mubone-audit-sentinel'),
    'pre-reset cache contents are gone', `caches now: ${after.cacheNames.join(', ') || '(none)'}`);
  const missingAfter = MODALS.filter(id => !after.modalIds.includes(id));
  check(after.panels >= PANELS.length && missingAfter.length === 0, 'app boots clean after reset',
    `${after.panels} panels, ${after.modals} modals${missingAfter.length ? `, missing: ${missingAfter.join(', ')}` : ''}`);
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
      await auditOrigin(browser, HOSTED, { expectBridgeAttempt: false });
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
