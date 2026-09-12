#!/usr/bin/env node
// ============================================================================
// ui-shots.js — layout screenshots + column geometry at the responsive tiers
//
// Renders the app at a set of widths and captures a screenshot per width plus a
// JSON dump of the rail/stage geometry, for diagnosing layout without
// eyeballing pixels.
//
// This used to load index.html in headless Chromium via playwright, which meant
// a browser download, a python server, and browser-mode layout standing in for
// the Electron build people actually use. It now drives a real Electron window
// through scripts/lib/rig.js — no setup, and the pixels are the shipped ones.
//
// Run:
//   node scripts/ui-shots.js                 # the four tier widths
//   node scripts/ui-shots.js 1400 900 520    # explicit widths
//   node scripts/ui-shots.js --attach 900    # resize the window you have open
//
// Screenshots land in /tmp/shot-<width>.png.
//
// The panel COLUMN TIERS went with the rig view (#291). What is left to check
// at each width is the one screen: the chrome, the stage, the rails and the
// footer — read the pixels, and the geometry dump for the stage itself.
//
// Note on --attach: a window someone has zoomed with Cmd+/Cmd- reports CSS
// widths that do not match its pixel size, so the tier you get is not the tier
// you asked for. The default (own instance) is always 1:1.
// ============================================================================

'use strict';

const { launch, attach } = require('./lib/rig');

const DEFAULT_WIDTHS = [1400, 1100, 800, 520];
const HEIGHT = 950;

(async () => {
  const args     = process.argv.slice(2);
  const doAttach = args.includes('--attach');
  const widths   = args.filter(a => /^\d+$/.test(a)).map(Number);
  const list     = widths.length ? widths : DEFAULT_WIDTHS;

  const rig = doAttach ? await attach() : await launch();
  try {
    for (const w of list) {
      const [innerW, innerH] = await rig.resize(w, HEIGHT);
      const geom = await rig.evaluate(() => {
        const box = sel => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const disp = getComputedStyle(el).display;
          return { sel, display: disp, x: Math.round(r.x), y: Math.round(r.y),
                   w: Math.round(r.width), h: Math.round(r.height),
                   hidden: disp === 'none' || r.width === 0 || r.height === 0 };
        };
        // The stage and everything that overlays or brackets it. A rail that
        // RESIZES the sphere is the regression worth catching here — the rails
        // are supposed to float over it (#258).
        const parts = ['.tc-bar', '.canvas-wrapper', '#toolRail', '#propRail',
                       '.tc-rail', '#paletteDock', '.tilebar', '.bottom-bar']
          .map(box).filter(Boolean);
        const canvas = document.querySelector('canvas');
        const cr = canvas?.getBoundingClientRect();
        return {
          cssWidth: window.innerWidth,
          body: document.body.className,
          parts,
          clipped: parts.filter(p => !p.hidden && (p.x < -1 || p.x + p.w > window.innerWidth + 1))
                        .map(p => p.sel),
          canvas: cr ? { x: Math.round(cr.x), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      const shot = `/tmp/shot-${w}.png`;
      await rig.screenshot(shot);
      console.log(`\n── ${w}px (css ${geom.cssWidth}, ${innerW}×${innerH})  body="${geom.body}"`);
      console.log(`   ${shot}`);
      console.log(`   ` +
                  (geom.canvas ? `canvas: x${geom.canvas.x} ${geom.canvas.w}×${geom.canvas.h}` : 'no canvas') +
                  (geom.clipped.length ? `   ⚠ CLIPPED: ${geom.clipped.join(' ')}` : '') +
                  (geom.overflowX ? '   ⚠ HORIZONTAL OVERFLOW' : ''));
      console.log(JSON.stringify(geom.parts));
    }
  } finally {
    if (!doAttach) await rig.close();
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
