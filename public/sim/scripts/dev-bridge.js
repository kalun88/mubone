/**
 * dev-bridge.js — opt-in remote diagnosis channel for a running mubone Electron app.
 *
 * WHY: Cowork/Claude runs in a sandbox that can read and write this repo folder but
 * cannot launch or see the macOS app. This turns the repo folder itself into the
 * transport, so a live app can be inspected while Ek watches the window.
 *
 * ENABLE:  npm run electron:dev          (sets MUBONE_DEV_BRIDGE=1)
 * DISABLE: npm run electron              (module is never required)
 *
 * PROTOCOL — everything lives under .dev-bridge/ (gitignored):
 *
 *   in/<id>.js     write JS here  -> evaluated in the renderer, result to out/<id>.json
 *   in/<id>.shot   write anything -> window PNG to out/<id>.png, metadata to out/<id>.json
 *   in/<id>.mouse  write {"x":n,"y":n} -> a REAL pointer move at those content coords.
 *                  :hover is driven by hit-testing, which no synthetic DOM event can
 *                  reach, so a harness that needs the pointer somewhere definite has to
 *                  go through the main process. scripts/lib/probe.js parks it.
 *   out/<id>.json  { ok, value | error, stack, ms, console: [...since command started] }
 *   console.log    rolling capture: renderer console, load failures, crashes, main errors
 *   status.json    rewritten every poll: pid, url, title, uptime, bounds — proof it's alive
 *
 * Input files are consumed (deleted) once handled. Write them atomically:
 *   printf '%s' 'S.particles.length' > in/q1.tmp && mv in/q1.tmp in/q1.js
 *
 * Evaluated source is tried as an EXPRESSION first (so `S.particles.length` returns 14),
 * falling back to STATEMENT mode on SyntaxError (so multi-line code with `return` works).
 * Results are serialised defensively — S is deeply circular, so values are depth-capped,
 * array/key-capped, and DOM nodes come back as selector + bounding rect.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const POLL_MS      = 250;
const LOG_CAP      = 2 * 1024 * 1024;   // truncate console.log past this
const RING         = 400;               // console entries kept in memory
// 30 s: pins § P walks the cursor out of a take in 40 ms steps, three zones in
// one eval, and under load (a full rig run beside four other processes,
// 2026-09-13) that passed 10 s and the suite read "eval timeout" as a failure.
const EVAL_TIMEOUT = 30000;

// Serialiser injected into the renderer alongside the user's code.
const SAFE = `
function __mbSafe(v, depth, seen) {
  depth = depth || 0; seen = seen || new Set();
  if (v === undefined) return '[undefined]';
  if (v === null) return null;
  const t = typeof v;
  if (t === 'boolean') return v;
  if (t === 'number') return Number.isFinite(v) ? v : String(v);
  if (t === 'string') return v.length > 4000 ? v.slice(0, 4000) + '[+' + (v.length - 4000) + ' chars]' : v;
  if (t === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (t === 'symbol' || t === 'bigint') return String(v);
  if (v instanceof Error) return { __type: 'Error', name: v.name, message: v.message,
    stack: String(v.stack || '').split('\\n').slice(0, 12).join('\\n') };
  if (typeof Element !== 'undefined' && v instanceof Element) {
    const r = v.getBoundingClientRect();
    const cls = (typeof v.className === 'string' && v.className.trim())
      ? '.' + v.className.trim().split(/\\s+/).join('.') : '';
    return { __type: 'Element', sel: v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + cls,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  }
  if (ArrayBuffer.isView(v)) return { __type: v.constructor.name, length: v.length,
    head: Array.from(v.slice(0, 8)) };
  if (seen.has(v)) return '[Circular]';
  if (depth >= 4) return Array.isArray(v) ? '[Array(' + v.length + ')]' : '[Object]';
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const out = v.slice(0, 50).map(x => __mbSafe(x, depth + 1, seen));
      if (v.length > 50) out.push('[+' + (v.length - 50) + ' more]');
      return out;
    }
    if (v instanceof Map) return { __type: 'Map', size: v.size,
      entries: Array.from(v.entries()).slice(0, 30).map(e => [__mbSafe(e[0], depth + 1, seen), __mbSafe(e[1], depth + 1, seen)]) };
    if (v instanceof Set) return { __type: 'Set', size: v.size,
      values: Array.from(v).slice(0, 30).map(x => __mbSafe(x, depth + 1, seen)) };
    const out = {}, keys = Object.keys(v);
    for (const k of keys.slice(0, 80)) {
      try { out[k] = __mbSafe(v[k], depth + 1, seen); }
      catch (e) { out[k] = '[getter threw: ' + e.message + ']'; }
    }
    if (keys.length > 80) out['__more'] = '[+' + (keys.length - 80) + ' keys]';
    return out;
  } finally { seen.delete(v); }
}
`;

function wrapExpression(src) {
  return `(async () => { ${SAFE}
  try { const __v = await (${src}
  ); return { ok: true, value: __mbSafe(__v) }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e),
    stack: String((e && e.stack) || '').split('\\n').slice(0, 15).join('\\n') }; }
})()`;
}

function wrapStatements(src) {
  return `(async () => { ${SAFE}
  try { const __v = await (async () => { ${src}
  })(); return { ok: true, value: __mbSafe(__v) }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e),
    stack: String((e && e.stack) || '').split('\\n').slice(0, 15).join('\\n') }; }
})()`;
}

function attachDevBridge(win, rootDir) {
  // MUBONE_DEV_BRIDGE_DIR lets a second instance (scripts/lib/rig.js launches
  // one for audits) own a private channel, so two bridges never consume each
  // other's command files.
  const dir    = process.env.MUBONE_DEV_BRIDGE_DIR || path.join(rootDir, '.dev-bridge');
  const inDir  = path.join(dir, 'in');
  const outDir = path.join(dir, 'out');
  const logF   = path.join(dir, 'console.log');
  const statF  = path.join(dir, 'status.json');

  for (const d of [dir, inDir, outDir]) fs.mkdirSync(d, { recursive: true });
  try { fs.writeFileSync(logF, ''); } catch (_) {}

  const ring = [];
  function record(level, text, source) {
    const e = { t: new Date().toISOString().slice(11, 23), level, text: String(text).slice(0, 4000) };
    if (source) e.source = source;
    ring.push(e);
    if (ring.length > RING) ring.shift();
    try {
      // Asynchronous (2026-09-06): both audio hops run on this event loop
      // now, and a synchronous append per console line was a stall of the
      // disk's choosing at exactly the moments the app logs — every take.
      const line = `${e.t} [${level}] ${e.source ? e.source + ' ' : ''}${e.text}\n`;
      fs.stat(logF, (err, st) => {
        if (!err && st.size > LOG_CAP) fs.writeFile(logF, '[truncated]\n' + line, () => {});
        else fs.appendFile(logF, line, () => {});
      });
    } catch (_) {}
  }

  // ── Renderer console ────────────────────────────────────────────────────────
  // Electron 34 emits (event, level, message, line, sourceId); newer versions
  // emit a single Event object. Accept whichever this runtime sends.
  const LEVELS = ['debug', 'info', 'warning', 'error'];
  win.webContents.on('console-message', (a, b, c, d, e) => {
    if (b === undefined && a && typeof a === 'object' && 'message' in a) {
      record(a.level || 'info', a.message, `${a.sourceId || '?'}:${a.lineNumber || 0}`);
    } else {
      record(LEVELS[b] || String(b), c, `${e || '?'}:${d || 0}`);
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    record('error', `did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('preload-error', (_e, file, err) =>
    record('error', `preload-error ${file} ${err && err.message}`));
  win.webContents.on('render-process-gone', (_e, details) =>
    record('error', `render-process-gone ${JSON.stringify(details)}`));
  win.webContents.on('unresponsive', () => record('error', 'renderer unresponsive'));
  win.webContents.on('did-finish-load', () => record('info', 'did-finish-load'));

  // ── Main process ────────────────────────────────────────────────────────────
  for (const m of ['log', 'warn', 'error']) {
    const orig = console[m].bind(console);
    console[m] = (...args) => {
      record(m === 'log' ? 'info' : m, args.map(a =>
        typeof a === 'string' ? a : (a instanceof Error ? a.stack : JSON.stringify(a))).join(' '), 'main');
      orig(...args);
    };
  }
  process.on('uncaughtException',  err => record('error', `main uncaught ${err && err.stack}`, 'main'));
  process.on('unhandledRejection', err => record('error', `main unhandled ${err && (err.stack || err)}`, 'main'));

  // ── Command loop ────────────────────────────────────────────────────────────
  function writeOut(id, payload) {
    const tmp = path.join(outDir, `${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, path.join(outDir, `${id}.json`));
  }

  // Decide expression-vs-statement by PARSING in the main process first. Probing the
  // renderer instead (try expression, fall back on throw) also works, but every
  // statement-mode query then leaves a red SyntaxError in Ek's DevTools console from
  // the discarded attempt. Main and renderer share the same V8, so a parse here is
  // authoritative. AsyncFunction, not Function, so top-level await still parses.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  function isExpression(src) {
    try { new AsyncFunction(`return (${src}\n);`); return true; }
    catch (_) { return false; }
  }

  async function evaluate(src) {
    const wrapped = isExpression(src) ? wrapExpression(src) : wrapStatements(src);
    return await win.webContents.executeJavaScript(wrapped, true);
  }

  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      let files;
      try { files = fs.readdirSync(inDir).filter(f => /\.(js|shot|mouse)$/.test(f)).sort(); }
      catch (_) { files = []; }

      for (const f of files) {
        const id   = f.replace(/\.(js|shot|mouse)$/, '');
        const full = path.join(inDir, f);
        const mark = ring.length;
        const t0   = Date.now();
        let payload;
        try {
          if (f.endsWith('.mouse')) {
            const { x, y } = JSON.parse(fs.readFileSync(full, 'utf8'));
            // Two moves: Chromium coalesces a move to where the pointer already
            // is, and the second one is what forces the hover recompute.
            win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
            win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) + 1 });
            payload = { ok: true, value: { x: Math.round(x), y: Math.round(y) + 1 } };
          } else if (f.endsWith('.shot')) {
            const img = await win.webContents.capturePage();
            const png = path.join(outDir, `${id}.png`);
            fs.writeFileSync(png, img.toPNG());
            const size = img.getSize();
            payload = { ok: true, value: { shot: `.dev-bridge/out/${id}.png`, width: size.width, height: size.height } };
          } else {
            const src = fs.readFileSync(full, 'utf8');
            payload = await Promise.race([
              evaluate(src),
              new Promise((_, rej) => setTimeout(() => rej(new Error(`eval timeout after ${EVAL_TIMEOUT}ms`)), EVAL_TIMEOUT)),
            ]);
          }
        } catch (err) {
          payload = { ok: false, error: String((err && err.message) || err),
            stack: String((err && err.stack) || '').split('\n').slice(0, 15).join('\n') };
        }
        payload.ms = Date.now() - t0;
        payload.console = ring.slice(mark);
        writeOut(id, payload);
        try { fs.unlinkSync(full); } catch (_) {}
      }

      // Asynchronous too (2026-09-06): a synchronous write four times a
      // second on the loop that carries the audio hops was jitter for free.
      try {
        const b = win.getBounds();
        fs.writeFile(statF, JSON.stringify({
          alive: true, pid: process.pid, title: win.getTitle(),
          url: win.webContents.getURL(), bounds: b,
          visible: win.isVisible(), focused: win.isFocused(),
          uptimeSec: Math.round(process.uptime()), at: new Date().toISOString(),
        }, null, 2), () => {});
      } catch (_) {}
    } finally { busy = false; }
  }

  const timer = setInterval(tick, POLL_MS);
  timer.unref?.();
  win.on('closed', () => {
    clearInterval(timer);
    try { fs.writeFileSync(statF, JSON.stringify({ alive: false, at: new Date().toISOString() }, null, 2)); } catch (_) {}
  });

  record('info', `dev-bridge attached — poll ${POLL_MS}ms, root ${dir}`, 'main');
  console.log(`[dev-bridge] listening in ${path.relative(rootDir, inDir)}/`);
}

module.exports = { attachDevBridge };
