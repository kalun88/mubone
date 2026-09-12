// ============================================================================
// rig.js — drive a real mubone Electron instance from a node script
//
// WHY: the audit harnesses used to load index.html in headless Chromium with
// playwright, which meant they tested the BROWSER build to catch bugs that bite
// on the Electron rig, and needed a chromium download plus a python server to
// run at all. The dev bridge (scripts/dev-bridge.js) already talks to a live
// app through the filesystem, so the same assertions can run against the real
// thing with no dependencies.
//
// This is the client half of that bridge, shaped like the slice of playwright's
// page API the audits actually used, so their evaluate() bodies port unchanged:
//
//   const rig = await launch();          // own instance, own profile, own port
//   const rig = await attach();          // whatever `npm run electron:dev` has open
//   await rig.evaluate(fn, arg)          // runs fn in the renderer, returns its value
//   await rig.reload()                   // fresh page state
//   await rig.screenshot('/tmp/x.png')
//   rig.errors()                         // renderer errors seen since launch
//   await rig.close()
//
// TRANSPORT NOTE: the bridge's serialiser is built for interactive probing of S,
// which is deeply circular — it caps depth at 4, arrays at 50 and strings at
// 4000 chars. An audit returning nested report objects would silently lose data
// to those caps. So evaluate() has the renderer JSON.stringify its own result
// and hands it back in chunks, which parses losslessly on this side. The only
// remaining ceiling is 50 × 3000 chars; past that you get a clear error rather
// than a quietly truncated report.
// ============================================================================

'use strict';

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const { spawn } = require('child_process');

const ROOT       = path.resolve(__dirname, '..', '..');
const POLL_MS    = 100;
const BOOT_MS    = 30000;   // electron cold start + app init
const EVAL_MS    = 20000;   // bridge itself times out at 10s; this is the outer bound
const CHUNK      = 3000;    // stay under the bridge's 4000-char string cap
const MAX_CHUNKS = 50;      // the bridge's array cap

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient(dir, proc) {
  const inDir  = path.join(dir, 'in');
  const outDir = path.join(dir, 'out');
  const logF   = path.join(dir, 'console.log');
  let seq = 0;
  let logOffset = 0;
  try { logOffset = fs.statSync(logF).size; } catch (_) {}

  async function raw(src, timeoutMs = EVAL_MS) {
    const id  = `rig${process.pid}_${++seq}`;
    const tmp = path.join(inDir, `${id}.tmp`);
    fs.writeFileSync(tmp, src);
    fs.renameSync(tmp, path.join(inDir, `${id}.js`));

    const outF = path.join(outDir, `${id}.json`);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (fs.existsSync(outF)) {
        const txt = fs.readFileSync(outF, 'utf8');
        // Best effort: consuming the file keeps out/ tidy, it is not part of
        // the protocol — every id carries the pid and a counter, so a leftover
        // is never read again. It has to be best effort because the folder is
        // not always deletable: mounted into a sandbox (Cowork's bridge to the
        // repo), unlink returns EPERM, and a hard failure here took down EVERY
        // rig-based audit with "app never came up" — a permissions error
        // wearing a timeout's clothes. The bridge answered every call.
        try { fs.unlinkSync(outF); } catch (_) {}
        return JSON.parse(txt);
      }
      await sleep(POLL_MS);
    }
    throw new Error(`rig.evaluate timed out after ${timeoutMs}ms — is the app still up?`);
  }

  return {
    dir,
    proc,
    // True when this client is driving a window someone else opened, so a
    // suite can refuse the destructive things that are free on a throwaway
    // profile. See osc-audit's freshProbe.
    attached: !proc,

    // Mirrors page.evaluate(fn, arg): fn runs in the renderer, may be async.
    async evaluate(fn, arg) {
      const payload = JSON.stringify(arg === undefined ? null : arg);
      const src =
        `const __fn = ${fn.toString()};\n` +
        `const __r = await __fn(${payload});\n` +
        `const __s = JSON.stringify(__r === undefined ? null : __r);\n` +
        `const __c = [];\n` +
        `for (let i = 0; i < __s.length; i += ${CHUNK}) __c.push(__s.slice(i, i + ${CHUNK}));\n` +
        `return { __chunks: __c, __len: __s.length };`;

      const res = await raw(src);
      if (!res.ok) {
        const e = new Error(res.error);
        e.stack = res.stack || e.stack;
        throw e;
      }
      const v = res.value;
      if (!v || !Array.isArray(v.__chunks)) {
        throw new Error('rig.evaluate: unexpected bridge payload — ' + JSON.stringify(v).slice(0, 200));
      }
      if (v.__chunks.length >= MAX_CHUNKS) {
        throw new Error(
          `rig.evaluate: result is ${v.__len} chars, past the ${MAX_CHUNKS * CHUNK} the bridge can carry. ` +
          `Return a smaller summary from the renderer.`);
      }
      return JSON.parse(v.__chunks.join(''));
    },

    // Fresh page state, same process. Replaces "open a second browser context".
    async reload(settleMs = 3500) {
      await raw(`setTimeout(() => location.reload(), 30); return 'reloading';`);
      await sleep(settleMs);
      await this.waitForApp();
    },

    // Load with ?debug so dlog() output reaches the console capture.
    async setDebug(on, settleMs = 3500) {
      await raw(`setTimeout(() => { location.href = location.pathname${on ? " + '?debug'" : ''}; }, 30); return 'ok';`);
      await sleep(settleMs);
      await this.waitForApp();
    },

    // A REAL pointer move, through the main process. :hover is hit-testing, so
    // a dispatched DOM event cannot produce or clear it; this can.
    async mouse(x, y) {
      const id  = `rigmouse${process.pid}_${++seq}`;
      const tmp = path.join(inDir, `${id}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify({ x, y }));
      fs.renameSync(tmp, path.join(inDir, `${id}.mouse`));
      const outF = path.join(outDir, `${id}.json`);
      const t0 = Date.now();
      while (Date.now() - t0 < EVAL_MS) {
        if (fs.existsSync(outF)) {
          const r = JSON.parse(fs.readFileSync(outF, 'utf8'));
          fs.unlinkSync(outF);
          return r.value;
        }
        await sleep(POLL_MS);
      }
      throw new Error('rig.mouse timed out');
    },

    async screenshot(destPath) {
      const id  = `rigshot${process.pid}_${++seq}`;
      const tmp = path.join(inDir, `${id}.tmp`);
      fs.writeFileSync(tmp, 'x');
      fs.renameSync(tmp, path.join(inDir, `${id}.shot`));
      const png = path.join(outDir, `${id}.png`);
      const t0 = Date.now();
      while (Date.now() - t0 < EVAL_MS) {
        if (fs.existsSync(png)) {
          if (destPath) { fs.copyFileSync(png, destPath); fs.unlinkSync(png); return destPath; }
          return png;
        }
        await sleep(POLL_MS);
      }
      throw new Error('rig.screenshot timed out');
    },

    async resize(w, h) {
      await raw(`window.resizeTo(${w}, ${h}); return [innerWidth, innerHeight];`);
      await sleep(400);
      return this.evaluate(() => [window.innerWidth, window.innerHeight]);
    },

    // Renderer errors since launch. The bridge records console errors and
    // uncaught exceptions alike, so this covers what page.on('pageerror') did.
    errors() {
      let txt = '';
      try {
        const fd = fs.openSync(logF, 'r');
        const size = fs.statSync(logF).size;
        if (size > logOffset) {
          const buf = Buffer.alloc(size - logOffset);
          fs.readSync(fd, buf, 0, buf.length, logOffset);
          txt = buf.toString('utf8');
        }
        fs.closeSync(fd);
      } catch (_) { return []; }
      return txt.split('\n')
        .filter(l => l.includes('[error]'))
        // Electron's own security warning is not the app's problem.
        .filter(l => !/Insecure Content-Security-Policy|electronjs.org\/docs/.test(l))
        .map(l => l.slice(0, 300));
    },

    async waitForApp(timeoutMs = BOOT_MS) {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < timeoutMs) {
        try {
          const r = await raw(`(typeof document !== 'undefined' && document.readyState === 'complete'
             && !!document.getElementById('muteBtn'))`, 3000);
          if (r.ok && r.value === true) return true;
          last = r.ok ? 'app not painted yet' : r.error;
        } catch (e) { last = e.message; }
        await sleep(300);
      }
      throw new Error(`app never came up: ${last}`);
    },

    // Silence output before a sweep. dispatching every cc action walks master
    // gain to the top of its range, which on the rig is a real noise.
    async mute() {
      return this.evaluate(async () => {
        const { S } = await import('./js/state.js');
        const btn = document.getElementById('muteBtn');
        if (!S.isMuted && btn) btn.click();
        // The real input too: an audit must hear only what it injects, never
        // the room (ui-audio-settings.js S._silenceRtInput).
        S._silenceRtInput?.(true);
        return !!S.isMuted;
      });
    },

    // Stop the app's own 20 ms scheduler. Any audit that drives the engine with
    // synthetic timestamps must own the tick: js/grain.js:970 calls
    // _updateTriggerGates() from scheduleGrains(), so a live scheduler races the
    // test, consuming gate edges under it. The old playwright harnesses never
    // hit this — browser mode has no running AudioContext, so scheduleGrains()
    // returned early and the engine sat inert.
    async quiesce() {
      return this.evaluate(async () => {
        const { S } = await import('./js/state.js');
        if (S._grainSchedulerId) { clearInterval(S._grainSchedulerId); S._grainSchedulerId = null; return true; }
        return false;
      });
    },

    async close() {
      if (!proc) return;
      try { proc.kill('SIGTERM'); } catch (_) {}
      const t0 = Date.now();
      while (proc.exitCode === null && Date.now() - t0 < 5000) await sleep(100);
      try { if (proc.exitCode === null) proc.kill('SIGKILL'); } catch (_) {}
    },
  };
}

// Where electron-main puts an instance's userData (app.setPath('userData',
// <default>/instances/<name>)); the default is Electron's per-platform appData.
function instanceProfileDir(name) {
  const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(appData, 'mubone', 'instances', name);
}

// Launch a private instance: own userData profile (so it cannot touch Ek's
// presets or calibration), own OSC port (so it cannot fight the live app for
// 7500), own bridge directory (so the two bridges cannot eat each other's
// command files).
async function launch(opts = {}) {
  // MUBONE_RIG_ATTACH=1 turns every launch() in the suite into an attach().
  // It exists for one situation: a machine that cannot execute the Electron
  // binary — a Linux sandbox with the macOS build in node_modules — where the
  // choice is running the assertions against the app already on screen or not
  // running them at all.
  //
  // It is NOT the default and should not become one. launch() gives each suite
  // its own profile (--instance=audit) and its own OSC port precisely so an
  // audit that dispatches actions and injects particles cannot touch your
  // presets or a live station. Attaching gives all of that up: the audits will
  // mutate the window you are looking at and write through to its real
  // localStorage. Snapshot and restore around it, or accept the loss.
  if (process.env.MUBONE_RIG_ATTACH === '1') return attach({ dir: opts.dir });
  // MUBONE_RIG_INSTANCE / MUBONE_RIG_PORT let a second concurrent session run the
  // suites without sharing this one's profile and port (docs/AUDITS.md § 1).
  // A FRESH profile per launch, deleted on close. The shared `audit` profile
  // used to persist across runs, and the sweeps wrote into it — cc-mirror left
  // mainInputChannel at "stereo" and outputGain at 9.5 — so the day Ek's mono
  // headphones became the default input, audify could not open the stream and
  // every recording test failed on that profile while a fresh one passed
  // (2026-09-05). A named instance (opts or MUBONE_RIG_INSTANCE) is kept.
  const named    = opts.instance || process.env.MUBONE_RIG_INSTANCE;
  const instance = named || `audit-${process.pid}`;
  const oscPort  = opts.oscPort  || Number(process.env.MUBONE_RIG_PORT) || 7599;
  const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'mubone-rig-'));
  fs.mkdirSync(path.join(dir, 'in'),  { recursive: true });
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });

  const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electron)) throw new Error(`electron not found at ${electron} — run npm install`);

  const proc = spawn(electron, ['.', `--instance=${instance}`, `--osc-port=${oscPort}`], {
    cwd: ROOT,
    // MUBONE_RIG_BACKGROUND: the window comes up inactive with no dock icon, so a
    // suite never steals focus or switches the Space Ek is working on.
    env: { ...process.env, MUBONE_DEV_BRIDGE: '1', MUBONE_DEV_BRIDGE_DIR: dir, MUBONE_RIG_BACKGROUND: '1' },
    stdio: 'ignore',
    detached: false,
  });

  const client = makeClient(dir, proc);
  if (!named) {
    const profile = instanceProfileDir(instance);
    const baseClose = client.close.bind(client);
    client.close = async () => { await baseClose(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} };
  }
  await client.waitForApp();
  if (opts.mute !== false) await client.mute();
  return client;
}

// Attach to whatever `npm run electron:dev` already has open. Convenient for
// diagnosing a live session, but every audit here MUTATES state — it dispatches
// actions and injects particles — so don't attach to a window you are playing.
async function attach(opts = {}) {
  // MUBONE_DEV_BRIDGE_DIR points the probes at a private instance (the same env
  // align-audit reads), so a CSS pass can be measured without touching the
  // window Ek is playing.
  const dir = opts.dir || process.env.MUBONE_DEV_BRIDGE_DIR || path.join(ROOT, '.dev-bridge');
  const statF = path.join(dir, 'status.json');
  if (!fs.existsSync(statF)) throw new Error(`no bridge at ${dir} — start the app with: npm run electron:dev`);
  const st = JSON.parse(fs.readFileSync(statF, 'utf8'));
  if (!st.alive) throw new Error('bridge says the app is not alive — start it with: npm run electron:dev');
  const client = makeClient(dir, null);
  await client.waitForApp(5000);
  return client;
}

module.exports = { launch, attach };
