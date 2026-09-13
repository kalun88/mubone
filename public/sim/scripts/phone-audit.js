#!/usr/bin/env node
// ── phone-audit.js — the PHONE build of the hosted demo, as a phone sees it ──
//
// mubone on a phone is the hosted demo (mubone.org/sim) in the phone's
// browser: the gyro is the sensor, a touch is the spacebar, and the chrome
// is gone (Ek, 2026-09-12: "the phone version is a really dumb simple
// version … i dont want to develop a separate app"). Nobody develops for the
// phone; this is the ONE check that says whether it still works, run when
// js/mobile.js, the mobile-mode CSS, or the hand's touch path changes.
//
// It emulates an iPhone (Safari's rules are the strict ones: the motion
// permission must be asked INSIDE the tap's own call stack) and an Android
// phone, on playwright's chromium, and checks:
//   · mobile mode is on and the desktop chrome is hidden
//   · the tap-to-begin flow finishes fast (TODO #349: it took 37 s once)
//   · the motion permission is requested synchronously in the tap
//   · a gyro event turns the camera
//   · a touch on the sphere plays the hand, and the release ends it
//   · no page errors
//
// Needs playwright-core's chromium (see browser-audit.js). Run:
//   node scripts/phone-audit.js

const { chromium, devices } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8139;
// A HOSTED origin (browser-audit.js: chromium resolves *.localhost itself and
// treats it as secure): the phone runs the hosted demo, which never tries the
// OSC bridge WebSocket — on a bare localhost origin that attempt logs errors.
const HOST = 'demo.localhost';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(root, port) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

let FAILURES = 0;
function check(ok, label, detail) { if (!ok) FAILURES++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`); }

// What a phone shows: the canvas and the phone's own overlay. Everything the
// rig view draws around the stage is desktop.
const DESKTOP_CHROME = ['#tcBar', '#toolRail', '#propRail', '#tcRail', '#paletteDock .tile[data-pal]', '#paletteDock .tile-binds', '.hud'];

// The iOS permission stub: records whether it was called INSIDE the tap's
// call stack (before the click handler returned to the event loop), which is
// Safari's rule. A stub on chromium is the only way to test that ordering
// here; the real prompt on a real iPhone follows the same rule.
const IOS_INIT = `
  window.__perm = { calls: 0, sync: null };
  document.addEventListener('click', () => { window.__clickReturned = false; setTimeout(() => { window.__clickReturned = true; }, 0); }, true);
  window.DeviceMotionEvent = window.DeviceMotionEvent || function () {};
  window.DeviceMotionEvent.requestPermission = () => { window.__perm.calls++; window.__perm.sync = window.__clickReturned === false; return Promise.resolve('granted'); };
`;

async function phone(browser, label, device, { ios }) {
  console.log(`\n── ${label} ──`);
  // Chromium's emulation has DeviceMotionEvent.requestPermission and answers
  // 'denied' unless the sensor permissions are granted; a real phone's Chrome
  // has no such call. The mic prompt is auto-granted by the launch flags.
  const ctx = await browser.newContext({ ...device, permissions: ['microphone', 'accelerometer', 'gyroscope', 'magnetometer'] });
  if (ios) await ctx.addInitScript(IOS_INIT);
  const page = await ctx.newPage();
  const errs = [], trace = [];
  page.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); if (m.text().startsWith('[mobile]')) trace.push(m.text().slice(9, 120)); });
  await page.goto(`http://${HOST}:${PORT}/index.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(async () => { window.__S = (await import('./js/state.js')).S; });

  const boot = await page.evaluate((chrome) => {
    const vis = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    return { isMobile: !!window.__S.isMobile, mode: document.body.classList.contains('mobile-mode'),
             enter: vis('#mobileEnterBtn'), shown: chrome.filter(vis) };
  }, DESKTOP_CHROME);
  check(boot.isMobile && boot.mode, 'the page boots in mobile mode', JSON.stringify(boot));
  check(boot.enter === true, 'the tap-to-begin overlay is up', String(boot.enter));
  check(boot.shown.length === 0, 'the desktop chrome is hidden — the bar, the rails, the strip and its stickers', boot.shown.join(', ') || 'none shown');
  const handTile = await page.evaluate(() => { const el = document.getElementById('handKey'); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; });
  check(handTile === true, 'the palette is the hand tile alone, and it shows', String(handTile));

  // TAP TO BEGIN. Timed: the mic prompt is auto-granted, fullscreen is
  // refused by headless chromium, so this is the app's own flow.
  const t0 = Date.now();
  await page.tap('#mobileEnterBtn');
  let done = false;
  let polls = 0;
  for (let i = 0; i < 80 && !done; i++) { polls++; done = await page.evaluate(() => !!window.__S._mobileSetupDone); if (!done) await page.waitForTimeout(100); }
  const ms = Date.now() - t0;
  if (process.env.PHONE_TRACE) console.log(`    · ${polls} poll(s), ${ms} ms`);
  // The app's own tap-time trace ([mobile] lines) says where a flow stopped.
  check(done, 'tap to begin finishes the phone setup', (done ? `${ms} ms` : `not done after ${ms} ms`) + ' · ' + (trace.join(' → ') || 'no trace'));
  check(ms < 4000, 'the setup finishes within 4 s (TODO #349: 37 s once)', `${ms} ms`);
  if (ios) {
    const perm = await page.evaluate(() => window.__perm);
    check(perm.calls >= 1, 'iOS: the motion permission is requested', `${perm.calls} call(s)`);
    check(perm.sync === true, 'iOS: … INSIDE the tap\'s own call stack, before any await — Safari refuses it later', `sync=${perm.sync}`);
  }
  const after = await page.evaluate((chrome) => {
    const vis = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    return { enter: vis('#mobileEnterBtn'), shown: chrome.filter(vis), ctx: window.__S.audioCtx?.state ?? null, mic: !!window.__S.micPermissionGranted };
  }, DESKTOP_CHROME);
  check(after.enter === false, 'the overlay is gone after the tap', String(after.enter));
  check(after.ctx === 'running', 'the audio context is running after the tap', String(after.ctx));
  check(after.mic, 'the mic is open after the tap', String(after.mic));

  // THE GYRO TURNS THE CAMERA: one synthetic devicemotion event.
  const gyro = await page.evaluate(() => {
    const q0 = window.__S.camQ.slice();
    const ev = new Event('devicemotion');
    Object.defineProperty(ev, 'rotationRate', { value: { alpha: 90, beta: 60, gamma: 0 } });
    Object.defineProperty(ev, 'interval', { value: 16 });
    window.dispatchEvent(ev);
    const q1 = window.__S.camQ;
    return { moved: q0.some((v, i) => Math.abs(v - q1[i]) > 1e-6), active: !!window.__S.orientationActive };
  });
  check(gyro.moved && gyro.active, 'a gyro event turns the camera', JSON.stringify(gyro));

  // A TOUCH IS THE SPACEBAR: hold on the sphere plays the hand, release ends it.
  const touch = type => page.evaluate((type) => {
    const c = document.getElementById('sphereCanvas'); const r = c.getBoundingClientRect();
    const t = new Touch({ identifier: 1, target: c, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    c.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t], targetTouches: type === 'touchend' ? [] : [t] }));
  }, type);
  await touch('touchstart');
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({ active: !!window.__S._gestureActive?.(), hand: localStorage.getItem('mubone_hand') }));
  await touch('touchend');
  await page.waitForTimeout(150);
  const released = await page.evaluate(() => ({ active: !!window.__S._gestureActive?.() }));
  check(held.active, 'a touch on the sphere plays the tool in hand', JSON.stringify(held));
  check(!released.active, '… and lifting the finger ends it', JSON.stringify(released));
  // THE HAND TILE IS A SPACEBAR ON THE PHONE TOO: a touch on it plays the hand.
  const touchTile = type => page.evaluate((type) => {
    const el = document.getElementById('handKey'); const r = el.getBoundingClientRect();
    const t = new Touch({ identifier: 2, target: el, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t], targetTouches: type === 'touchend' ? [] : [t] }));
  }, type);
  await touchTile('touchstart'); await page.waitForTimeout(150);
  const tileHeld = await page.evaluate(() => !!window.__S._gestureActive?.());
  await touchTile('touchend'); await page.waitForTimeout(150);
  const tileUp = await page.evaluate(() => !!window.__S._gestureActive?.());
  check(tileHeld && !tileUp, 'a touch on the hand tile plays the hand, and lifting ends it', JSON.stringify({ tileHeld, tileUp }));

  check(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | '));
  await ctx.close();
}

(async () => {
  const srv = await serve(ROOT, PORT);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    // PHONE_ONLY=ios | android runs one; the order is Android first so a slow
    // second context (TODO #349) cannot hide behind the first.
    const only = process.env.PHONE_ONLY;
    if (only !== 'ios') await phone(browser, 'Android (Chrome)', devices['Pixel 5'], { ios: false });
    if (only !== 'android') await phone(browser, 'iPhone (Safari rules)', devices['iPhone 13'], { ios: true });
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(FAILURES ? `\n${FAILURES} phone check(s) FAILED.` : '\nAll phone checks passed.');
  process.exit(FAILURES ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
