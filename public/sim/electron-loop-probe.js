// ============================================================================
// LOOP PROBE — who held this event loop, and for how long (2026-09-06, R6)
// Shared by electron-main.js and audio-host.js: a 4 ms timer measures how
// late the loop runs (max since the last read, counts over 10 and 20 ms),
// timed() wraps a callback and keeps its longest synchronous run and how
// often it passed 10 ms, and GC pauses are counted through perf_hooks.
// stats() is what get-output-depth carries to the renderer (S.transportDiag)
// and wg.status() prints. The audio host's loop is the one a hole comes
// from now; the main process's is the browser thread, kept for the record.
// ============================================================================
const _slow = new Map();   // name → { max, over10 }

function timed(name, fn) {
  return function (...args) {
    const t = process.hrtime.bigint();
    try { return fn.apply(this, args); }
    finally {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      const e = _slow.get(name) || { max: 0, over10: 0 };
      if (ms > e.max) e.max = ms;
      if (ms > 10) e.over10++;
      _slow.set(name, e);
    }
  };
}

// Every ipcMain handler runs through timed(); an async handler is timed to
// its first await — the part that blocks.
function wrapIpcMain(ipcMain) {
  const origHandle = ipcMain.handle.bind(ipcMain), origOn = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (name, fn) => origHandle(name, timed('ipc:' + name, fn));
  ipcMain.on = (name, fn) => origOn(name, timed('ipc:' + name, fn));
}

// ── The gap timer runs only while someone is watching (P1, 2026-09-06) ─────
// Measured that day: this interval costs 0.97 % of a core, in EACH of the two
// processes, and it used to run from load whether or not anything read it —
// including through a show, on battery, waking the audio host's own loop 250
// times a second. It is armed by a `stats(true)` call and disarms itself ten
// seconds later, so `wg.status()`, `transport-probe.js` and Settings → Audio
// all still get live gaps and a show carries none of it.
//
// The PERIOD stays 4 ms. Widening it looks like the cheap fix and is not: the
// metric is lateness BEYOND the period, so at 10 ms a 14 ms stall reads as a
// 4 ms gap and never reaches the over-10 bucket the cushion cares about.
const PERIOD_MS = 4;
const ARM_MS = 10000;
let _loopGapMax = 0, _loopGaps10 = 0, _loopGaps20 = 0;
let _timer = null, _armedUntil = 0, _last = 0n;
function arm() {
  _armedUntil = Date.now() + ARM_MS;
  if (_timer) return;
  _last = process.hrtime.bigint();
  _timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const gap = Number(now - _last) / 1e6 - PERIOD_MS;
    _last = now;
    if (gap > _loopGapMax) _loopGapMax = gap;
    if (gap > 10) _loopGaps10++;
    if (gap > 20) _loopGaps20++;
    if (Date.now() > _armedUntil) { clearInterval(_timer); _timer = null; }
  }, PERIOD_MS);
  if (_timer.unref) _timer.unref();   // never hold a process open for a gauge
}

let _gcMax = 0, _gcOver10 = 0;
try {
  const { PerformanceObserver } = require('perf_hooks');
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) { if (e.duration > _gcMax) _gcMax = e.duration; if (e.duration > 10) _gcOver10++; }
  }).observe({ entryTypes: ['gc'] });
} catch (_) {}

function slowTable() {
  return [..._slow.entries()].filter(([, e]) => e.max >= 2).sort((a, b) => b[1].max - a[1].max).slice(0, 8)
    .map(([name, e]) => [name, +e.max.toFixed(1), e.over10]);
}

/** The loop's figures; the gap max is since the last read. `want` ARMS the
 *  gap timer for the next ten seconds — pass it only when something is
 *  actually reading the gaps. The holders (`timed`, always on and measured at
 *  0.16 % of a core) and the GC counts are collected either way. */
function stats(want) {
  if (want) arm();
  const r = { loopGapMaxMs: +_loopGapMax.toFixed(1), loopGaps10: _loopGaps10, loopGaps20: _loopGaps20,
              slow: slowTable(), gcMaxMs: +_gcMax.toFixed(1), gcOver10: _gcOver10, gapsArmed: !!_timer };
  _loopGapMax = 0;
  return r;
}

module.exports = { timed, wrapIpcMain, stats };
