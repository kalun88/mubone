// ============================================================================
// ui-shots.js — headless layout screenshots at responsive tier widths
//
// Renders index.html (browser mode — no Electron bridge, no audio) in
// headless Chromium and captures a screenshot per width, plus a JSON dump of
// the projector-column geometry (positions/sizes) for diagnosing layout bugs
// without eyeballing pixels. This is a LAYOUT harness only — audio, RtAudio,
// sensors, and the worklet are not exercised.
//
// Setup (once per machine/sandbox):
//   npm install playwright-core          # no full playwright needed
//   npx playwright-core install chromium-headless-shell
//   # sandboxes without libXdamage.so.1: compile a stub —
//   #   echo 'long XDamageCreate(){return 0;} void XDamageDestroy(){} \
//   #     void XDamageSubtract(){} void XDamageAdd(){} \
//   #     int XDamageQueryExtension(){return 0;} int XDamageQueryVersion(){return 0;}' > /tmp/x.c
//   #   gcc -shared -fPIC -o /tmp/locallibs/libXdamage.so.1 /tmp/x.c
//   #   export LD_LIBRARY_PATH=/tmp/locallibs
//
// Run:
//   python3 -m http.server 8123 &        # from the repo root
//   node scripts/ui-shots.js 1400 1100 800 520
//   # screenshots land in /tmp/shot-<width>.png
//
// Tier expectations (css/style.css, RESPONSIVE COLUMN TIERS):
//   ≥1161 designed 5-slot · 961–1160 4-col · 701–960 3-col · ≤700 2-col narrow
// ============================================================================

const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const widths = process.argv.slice(2).map(Number);
  if (!widths.length) widths.push(1400, 1100, 800, 520);

  for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    page.on('pageerror', e => console.log(`PAGEERROR@${w}:`, e.message.slice(0, 150)));
    await page.goto('http://localhost:8123/index.html', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');   // dismiss first-run hint
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => ({
      projMode: document.body.classList.contains('projector-mode'),
      mini: (() => {
        const m = document.querySelector('.projector-mini-canvas');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        const c = m.querySelector('canvas')?.getBoundingClientRect();
        return { x: r.x | 0, y: r.y | 0, w: r.width | 0, h: r.height | 0, canvasH: c ? c.height | 0 : null };
      })(),
      cols: [...document.querySelectorAll('.projector-col')].map(c => {
        const r = c.getBoundingClientRect();
        return { col: c.dataset.col, x: r.x | 0, y: r.y | 0, w: r.width | 0, h: r.height | 0, tiles: c.children.length };
      }),
    }));
    console.log(`=== ${w}px`, JSON.stringify(info, null, 1).replace(/\n\s*/g, ' '));
    await page.screenshot({ path: `/tmp/shot-${w}.png` });
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
