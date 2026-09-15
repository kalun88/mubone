// ============================================================================
// osc-audit.js — OSC surface audit
//
// Answers one question: does every OSC address mubone advertises actually do
// something, and does it do it on the edge you'd expect from a Max patch?
//
// Four sections, each independently runnable via AUDIT_ONLY:
//
//   wiring  — static. Every `osc:` in the ACTIONS table has a case in the
//             osc.js dispatch switch; every id dispatched from osc.js has a
//             case in dispatchAction; every S._callback either handler path
//             calls is assigned somewhere in js/. No browser needed.
//   fire    — live. Boots index.html headless in a FRESH PAGE per address and
//             fires a valid payload, diffing a deep snapshot of S plus the
//             class/value of every id'd control. An address that changes
//             nothing anywhere is dead. Fresh page per address matters: the
//             handlers write to shared state, so a single page lets one
//             address's effect mask the next one's.
//   edges   — live. The thing static analysis can't see. Most trigger cases in
//             osc.js hardcode 127 and ignore the incoming value, so a Max
//             [toggle] or a button sending 1 then 0 fires them TWICE. This
//             section fires bang, then an explicit 0, and reports any address
//             where the 0 also moved state.
//   types   — live. `clamp()` is Math.max(min, Math.min(max, Number(v))), and
//             Number(undefined) is NaN, which survives both clamps. So a bang
//             onto a value address writes NaN into S with no error. This
//             section fires [] and ['abc'] at every value address and reports
//             what went non-finite.
//
// Runs against a real Electron instance via scripts/lib/rig.js — no setup, no
// server, no browser download. The instance is launched muted on its own
// profile and OSC port, so it cannot touch your presets or a live station.
//
//   node scripts/osc-audit.js
//   AUDIT_ONLY=wiring,edges node scripts/osc-audit.js
//   AUDIT_FROM=/trace node scripts/osc-audit.js   # start the sweep at an address
//   AUDIT_TRACE=1 node scripts/osc-audit.js       # print each address as it fires
//
// On fresh state: `fire` and `edges` reload the renderer before every address,
// because handlers write to shared state and one address's effect masks the
// next one's. That is not a precaution — sweeping all 99 in one page leaves the
// app in a state where /trace takes over ten seconds to return. Budget two to
// three minutes for a full run, or narrow it with AUDIT_ONLY. `types` needs one
// page, since it only asks what a bang writes.
//
// Exits non-zero if `wiring` finds a break or `fire` finds a dead address.
// `edges` and `types` report but do not fail — they describe the current
// contract, and changing it is a design decision, not a bug fix.
//
// KNOWN GAP — the addresses `fire` reports as dead are not dead; each needs a
// precondition seedMaterial() does not create. The families:
// /sampler/* need a loaded sample or live input (#247 replaced /paint/1..10),
// /mapping* and /mapping/toggle/* need a
// configured mapping, /cursor/tare needs a connected sensor, and /commit/release
// and /commit/clear need a commit to exist. Verified for the commit pair —
// /commit/clear moves #commitClearBtn.cls once something has been dropped, and
// nothing at all when the slots are empty, which is correct behaviour. Widening
// the seed to cover the other three families changes what this section treats as
// a fair test, so it is a decision rather than a fix.
//
// Limits: no sensor. Audio, mic and the worklet are all live now — /trace really
// records — so the old "no audio device" caveat is gone. Handlers whose only
// effect is audible (an AudioParam ramp with no mirrored S field) still read as
// a small diff or none; those are called out in docs/OSC-AUDIT-2026-08.md rather
// than asserted here.
// ============================================================================

const { launch } = require('./lib/rig');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ONLY = (process.env.AUDIT_ONLY || 'wiring,fire,edges,types').split(',').map(s => s.trim());

let failures = 0;
const ok   = m => console.log('  ✓ ' + m);
const bad  = m => { failures++; console.log('  ✗ ' + m); };
const note = m => console.log('  · ' + m);
const head = m => console.log('\n' + m + '\n' + '─'.repeat(m.length));

// ── Static: parse the ACTIONS table out of midi.js ───────────────────────────
// Regex rather than import because midi.js is an ES module with side effects
// (it wires DOM listeners at import time). The table is a flat literal, so a
// line scan is enough and stays honest — it reads what's actually written.

function parseActions() {
  const src = fs.readFileSync(path.join(ROOT, 'js/midi.js'), 'utf8');
  const lines = src.split('\n');
  const rows = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const m = /^\s*\{\s*id:\s*'([^']+)'/.exec(L);
    if (m) { cur = { id: m[1], text: L, line: i + 1 }; rows.push(cur); continue; }
    if (cur && L.trim() && !/^\s*\{\s*id:/.test(L)) cur.text += '\n' + L;
    if (/^\s*\{\s*id:\s*null/.test(L)) cur = null;
  }
  // Only ACTIONS rows carry a label; midi.js also opens `{ id: '…', verb }`
  // lines for the factory strip (PALETTE_FACTORY_ENTRIES, 2026-09-12), which
  // read as actions with no dispatch case until this filter.
  return rows.filter(r => /\blabel:/.test(r.text.split('\n')[0])).map(r => ({
    id:   r.id,
    line: r.line,
    osc:  (/osc:\s*'([^']+)'/.exec(r.text) || [])[1] || null,
    type: (/type:\s*'([^']+)'/.exec(r.text) || [])[1] || '?',
  }));
}

function oscCases() {
  const src = fs.readFileSync(path.join(ROOT, 'js/osc.js'), 'utf8');
  return new Set([...src.matchAll(/case\s+'([^']+)'/g)].map(m => m[1]));
}

function sectionWiring() {
  head('wiring — static cross-check');
  const acts  = parseActions();
  const cases = oscCases();
  const oscSrc  = fs.readFileSync(path.join(ROOT, 'js/osc.js'), 'utf8');
  const midiSrc = fs.readFileSync(path.join(ROOT, 'js/midi.js'), 'utf8');

  // 1. every advertised address is dispatched
  let gap = 0;
  for (const a of acts) {
    if (!a.osc) continue;
    if (!cases.has(a.osc)) { bad(`ACTIONS advertises ${a.osc} (${a.id}) but osc.js has no case — midi.js:${a.line}`); gap++; }
  }
  if (!gap) ok(`all ${acts.filter(a => a.osc).length} advertised addresses reach the osc.js dispatch`);

  // 2. every id osc.js dispatches exists as an action
  const ids  = new Set(acts.map(a => a.id));
  const sent = [...new Set([...oscSrc.matchAll(/_dispatchAction\?\.\('([^']+)'/g)].map(m => m[1]))];
  let g2 = 0;
  for (const s of sent) {
    if (!ids.has(s)) { bad(`osc.js dispatches action '${s}' which is not in ACTIONS`); g2++; }
  }
  if (!g2) ok(`all ${sent.length} action ids dispatched from osc.js exist in ACTIONS`);

  // 3. every non-cc action has a case in dispatchAction (or is prefix-handled)
  const body = midiSrc.slice(midiSrc.indexOf('function dispatchAction'));
  const dcases = new Set([...body.matchAll(/^\s*case\s+'([^']+)':/gm)].map(m => m[1]));
  let g3 = 0;
  for (const a of acts) {
    if (a.type === 'cc') continue;
    if (!dcases.has(a.id)) { bad(`action '${a.id}' has no case in dispatchAction — midi.js:${a.line}`); g3++; }
  }
  if (!g3) ok('every non-cc action resolves to a dispatchAction case or a prefix handler');

  // 4. every S._callback the two handler files invoke is assigned somewhere
  const jsDir = path.join(ROOT, 'js');
  const assigned = new Set();
  for (const f of fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of t.matchAll(/\bS\.(_[A-Za-z0-9_]+)\s*=[^=]/g)) assigned.add(m[1]);
  }
  let g4 = 0;
  for (const [file, src] of [['osc.js', oscSrc], ['midi.js', midiSrc]]) {
    for (const m of new Set([...src.matchAll(/\bS\.(_[A-Za-z0-9_]+)\?\.\(/g)].map(x => x[1]))) {
      if (!assigned.has(m)) { bad(`${file} calls S.${m}() but nothing in js/ ever assigns it`); g4++; }
    }
  }
  if (!g4) ok('every S._callback invoked by osc.js / midi.js is assigned in js/');

  // 5. informational: dispatched addresses with no ACTIONS row are invisible in
  //    the keys/midi/osc modal, so they can't be discovered from inside the app.
  const advertised = new Set(acts.map(a => a.osc));
  const hidden = [...cases].filter(c => !advertised.has(c));
  if (hidden.length) note(`handled but absent from the ACTIONS table (not listed in the app's OSC modal): ${hidden.join(' ')}`);
}

// ── Live sections ────────────────────────────────────────────────────────────

// Snapshot everything a handler could plausibly move: scalars anywhere in S to
// depth 2, array lengths, and the class + value of every id'd control. Audio
// nodes and DOM elements are skipped — they're cyclic and their interesting
// state is mirrored into S anyway.
const SNAP_FN = `() => {
  const S = window.__S, seen = new WeakSet(), o = {};
  const walk = (obj, pfx, d) => {
    if (d > 2) return;
    for (const k of Object.keys(obj)) {
      if (k.startsWith('_')) continue;
      let v; try { v = obj[k]; } catch (_) { continue; }
      const t = typeof v;
      if (v === null || t === 'number' || t === 'string' || t === 'boolean') o[pfx + k] = v;
      // Typed arrays are audio, not state. They are not Array.isArray and their
      // constructor is not in the skip list below, so without this the walk
      // enumerates every SAMPLE as a key — a recording buffer is hundreds of
      // thousands of them, and the snapshot never returns. Only reachable once
      // something actually records, which browser mode never did.
      else if (Array.isArray(v) || ArrayBuffer.isView(v)) o[pfx + k + '.len'] = v.length;
      else if (t === 'object' && !seen.has(v) && d < 2 && !(v instanceof Element)
               && !(v.constructor && /Audio|Gain|Canvas|Node|Context|Worklet|Media/.test(v.constructor.name))) {
        seen.add(v); walk(v, pfx + k + '.', d + 1);
      }
    }
  };
  walk(S, '', 0);
  document.querySelectorAll('[id]').forEach(el => {
    if (!/^(BUTTON|INPUT|SELECT)$/.test(el.tagName)) return;
    // _flash() clears .flashing on a 180 ms timer, so a class set by a PREVIOUS
    // probe decays during this one and reads as a change this probe caused.
    // It carries no information anyway — it's the visual ack, not the effect.
    o['#' + el.id + '.cls'] = el.className.replace(/\\bflashing\\b/g, '').trim();
    if ('value' in el) o['#' + el.id + '.val'] = el.value;
  });
  return o;
}`;

// camQ free-runs off the render loop, so it differs between any two snapshots
// taken a frame apart and is pure noise here.
//
// gazeTrail is the same category and was NOT here until 2026-08-24, which
// quietly disabled this whole section: the trail appends a point every render
// frame, so `gazeTrail.len` differed across every before/after pair, `total`
// was never 0, and the "changed nothing — dead address?" check below could not
// fire for any address. The sweep still took three minutes and still said PASS.
// Anything that mutates per frame must be listed here or it blinds the audit.
const NOISE = /^camQ\.|^cursorQ\.|^gazeTrail\.|Until$|^perf\.|^fps/;

// Addresses that legitimately move nothing in a fresh app, with the precondition
// each one is missing. These are the four families the header describes: they
// are NOT dead, and seedMaterial() deliberately does not create their state,
// because widening the seed changes what this section considers a fair test.
//
// They are listed rather than tolerated so that the "changed nothing" assertion
// keeps its teeth for the other ~79 addresses. Anything that goes quiet WITHOUT
// being listed here is a real finding. Delete an entry the day its precondition
// gets seeded.
const NEEDS_STATE = new Map([
  ['/cursor/tare',      'needs a connected sensor'],
  ['/commit/release',   'needs a commit to exist'],
  // The factory strip's unpin tile (2026-09-12: dots · line · loop · dub ·
  // scrape · pin · unpin). Proven on a rig: /palette/6 pins, /palette/7 then
  // releases it — with nothing pinned it has nothing to move.
  ['/palette/7',        'the factory unpin tile — needs a commit to exist'],
  // THE STRIP IS SEVEN TILES AND THE TABLE ADVERTISES NINE (2026-09-13). All
  // nine `palette_N` rows exist because the POSITION is the binding — one row
  // addresses whatever sits at N — but the factory list is pen · line · loop ·
  // dub · scrape · pin · unpin, so 8 and 9 have nothing to fire and firing
  // them is correctly a no-op. Listed, not tolerated: the day either position
  // is filled by default the entry comes out, exactly like /palette/7's will.
  ['/palette/8',        'position 8 is empty on the factory strip of seven'],
  // A RESET WITH NOTHING TO RESET. `pitch_oct_reset` sets the octave to 0 and
  // the octave IS 0 on fresh state, so on a clean profile it correctly moves
  // nothing. It passed some runs and failed others because the sweep's reload
  // restores the PROFILE, so whether a preceding address had left the octave
  // off zero decided the answer — which made the whole release set
  // non-deterministic on one line. Seed a non-zero octave before it and this
  // entry comes out.
  ['/grain/oct/reset',  'a reset with nothing to reset — the octave is 0 on fresh state'],
  ['/palette/9',        'position 9 is empty on the factory strip of seven'],
  // launch() starts the rig muted; a hold from muted to muted, released to
  // the state at press time (muted), moves nothing. Proven on a rig.
  ['/mute/hold',        'the rig launches muted; the hold restores the muted state it found'],
  ['/dry/mute/hold',    'same shape as /mute/hold — a hold that restores the state it found'],
  ['/undo',             'needs something to undo; the rig launches with an empty stack'],
  ['/commit/clear',     'needs a commit to exist'],
  // The MIX pair's second half (2026-09-15). `allOn()` clears every group and
  // pin flag, so on a rig that launches with nothing muted there is nothing for
  // it to clear and the snapshot cannot see it act. Proven live rather than
  // assumed: with one pin muted by setAllMuted, firing S._pinsAllOn() takes
  // isPinAudible false -> true. The address is not dead; the probe is blind to
  // it from a clean start, the same way /undo and /commit/clear are.
  ['/pins/unmuteall',   'needs something muted; the rig launches with nothing muted'],
  // And its other half, quiet for a DIFFERENT reason worth stating: with no
  // pins there is no group to mute. setAllMuted sets both group flags and then
  // calls applyMix(), whose pruneEmptyGroups clears the flag on any group
  // holding no pins — so on an empty rig the mute is undone inside the same
  // call. That is correct (a flag about pins in a group means nothing with none
  // in it) and it is the same fact allMuted() was taught to respect on
  // 2026-09-15. Proven with a pin present by pins-audit's ten MIX invariants.
  ['/pins/mute',        'needs a pin to exist; an empty group has its mute pruned in the same call'],
  // /mapping/toggle/1–4 were listed here until 2026-09-05, when the addresses
  // were deleted (never bound). Wet lives in tiles.js's module-local _tileCfg
  // and reaches localStorage on a 10 Hz poll, so the S snapshot cannot see it;
  // palette-audit § G is where wet is actually proven.
  ['/palette/wet',      'wet is tiles.js state (_tileCfg), not on S — proven by palette-audit'],
  ['/mapping1',         'needs a configured mapping row'],
  ['/mapping2',         'needs a configured mapping row'],
  ['/mapping3',         'needs a configured mapping row'],
  ['/source/sampler',   'select-only; painting from it needs a loaded sample'],
  ['/source/live',      'the boot default — selecting it again moves nothing'],
  ['/sampler/sample',   'needs a loaded sample'],
  ['/sampler/record',   'needs a live input to capture'],
  ['/redo',             'needs an undone stroke to reinstate (#246)'],
  ['/composer/allon',   'needs a commit to exist'],
]);

// Expose the two modules the probes drive. Must be re-run after every reload —
// a fresh renderer has no window.__osc.
async function bindProbe(rig) {
  await rig.evaluate(async () => {
    window.__osc = await import('./js/osc.js');
    window.__S   = (await import('./js/state.js')).S;
    return true;
  });
}

// Fresh app state before every address. Waits on a real readiness signal — the
// ACTIONS table being published on S — rather than a fixed sleep, which is both
// faster and correct on a slow machine.
//
// RECYCLING: a renderer reloaded enough times degrades. Around the fiftieth
// cycle a probe that takes 300 ms in a young instance stops returning at all
// (/trace was where it first showed). Playwright never met this because a fresh
// PAGE is a fresh renderer; reloading one 99 times is not the same thing. So
// the whole Electron process is replaced every RECYCLE_EVERY addresses, well
// inside the margin. A relaunch costs about 1.6 s against a reload's 1.0 s, so
// recycling more often would be affordable if this ever proves too generous.
const RECYCLE_EVERY = 15;

async function freshProbe(state) {
  if (state.n % RECYCLE_EVERY === 0) {
    if (state.rig) await state.rig.close();
    state.rig = await launch({ instance: 'audit-osc', oscPort: 7598 });
  } else {
    await state.rig.reload(150);
  }
  state.n++;
  const rig = state.rig;
  // Wipe persisted state. A reload and even a relaunch keep localStorage — it
  // belongs to the profile, not the page — so presets, mappings and audio
  // settings written by earlier addresses survive into later probes and are
  // restored on the next boot. This is a throwaway profile, so clearing it is
  // free.
  //
  // Unless it isn't. Under MUBONE_RIG_ATTACH this runs against a window the
  // player has open on their own profile, and "free" becomes "deleted their
  // presets, mappings, audio defaults and calibration" — which is exactly what
  // happened on 2026-08-30 before this guard existed. The clear is not
  // incidental to this suite: probes must not inherit each other's writes, so
  // weakening it would quietly weaken every assertion after the first. Refuse
  // instead, and say why.
  if (rig.attached) {
    throw new Error(
      'osc-audit clears localStorage between probes and cannot run attached — ' +
      'it would delete the presets and mappings of the window it is attached to. ' +
      'Run it with its own instance: `node scripts/osc-audit.js` without MUBONE_RIG_ATTACH.');
  }
  await rig.evaluate(() => { try { localStorage.clear(); } catch (_) {} return true; });
  for (let i = 0; i < 60; i++) {
    const ready = await rig.evaluate(async () => {
      const { S } = await import('./js/state.js');
      return !!(S._actions?.length && S._dispatchAction);
    });
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await bindProbe(rig);
  return rig;
}

// Seed particles + a stroke so erase / undo / sweep have something to act on.
//
// These must match the REAL schemas. The playwright version seeded
// {x,y,z,bufIdx,t} particles and an {id,kind,bufIdx,start} stroke — neither
// field set exists in the app, which writes {lon,lat,grainStart,grainDuration,
// liveBufferIdx} and {strokeId,type,liveBufferIndex} (js/ui-samples.js:328).
// Browser mode never walked the fiction, because the paint-release path returns
// early without a running AudioContext. In Electron it does walk it, and
// /trace on malformed material does not return.
async function seedMaterial(rig) {
  await rig.evaluate(async () => {
    const S = window.__S;
    const grain = await import('./js/grain.js');
    const octx = new OfflineAudioContext(1, 44100 * 4, 44100);
    S.liveRecBuffers = [{ buffer: octx.createBuffer(1, 44100 * 4, 44100), liveBuffer: null, grainCursor: 0 }];
    const sid = ++S.strokeIdCounter;
    for (let i = 0; i < 40; i++) {
      const p = { lon: -0.05 + (i / 39) * 0.1, lat: 0, strokeId: sid, source: 'live',
                  liveBufferIdx: 0, grainStart: i * 0.05, grainDuration: 0.2 };
      grain.stampCartesian(p);
      S.particles.push(p);
    }
    S.strokeHistory.push({ strokeId: sid, type: 'live', liveBufferIndex: 0 });
    S._particleVersion++;
    return { particles: S.particles.length, sid };
  });
}

// A plausible mid-range payload per value address. Anything absent is treated
// as a bang address.
const VALUES = {
  '/grain/dur': [123], '/grain/per': [77], '/grain/overlap': [2.5], '/grain/volume': [0.7],
  '/grain/pitch': [300], '/grain/pan': [55], '/grain/prob': [0.6], '/scan/fade': [400],
  '/grain/fade': [22], '/grain/durjitter': [0.4], '/grain/durvar': [111], '/grain/startjitter': [88],
  '/grain/pervar': [66], '/grain/retrigger': [40], '/grain/hpf': [180], '/grain/lpf': [7000],
  '/grain/hpfq': [3.3], '/grain/lpfq': [1.2], '/grain/filterjitter': [0.35], '/grain/pitchshift': [-700],
  '/search/radius': [33], '/search/recency': [4], '/search/k': [3],
  '/commit/xfade': [0.4], '/commit/loop_fade_time': [640], '/commit/attack': [1.5],
  '/commit/release_time': [2.5], '/commit/volume': [0.6], '/commit/speed': [1.5], '/commit/slots': [7],
  '/monitor/volume': [0.5], '/house/volume': [1.4], '/mixdown/cursor': [0.6], '/mixdown/house': [0.4],
  '/master/volume': [-12], '/gate/threshold': [0.02], '/dry/gain': [0.8],
  '/cursor/radiusfadecurve': [0.7],
  '/mapping1': [0.5], '/mapping2': [0.5], '/mapping3': [0.5],
};

function plan() {
  const acts  = parseActions();
  const cases = oscCases();
  const seen  = new Set();
  const list  = [];
  for (const a of acts) {
    if (!a.osc || seen.has(a.osc)) continue;
    seen.add(a.osc);
    list.push({ addr: a.osc, id: a.id, type: a.type });
  }
  for (const c of cases) if (!seen.has(c)) { seen.add(c); list.push({ addr: c, id: null, type: 'osc-only' }); }
  return list;
}

async function fireIn(rig, addr, payload) {
  return rig.evaluate(async ({ addr, payload, snapSrc, noise }) => {
    const snap = eval('(' + snapSrc + ')');
    const before = snap();
    let threw = null;
    try { window.__osc.handleOSC(addr, payload); } catch (e) { threw = String(e.message || e); }
    // Bounded: an Electron window that is occluded or behind another app stops
    // servicing requestAnimationFrame entirely, and an unbounded wait here hangs
    // the whole audit. Under playwright the page was always "visible" and this
    // could not happen.
    await Promise.race([
      new Promise(r => requestAnimationFrame(r)),
      new Promise(r => setTimeout(r, 60)),
    ]);
    await new Promise(r => setTimeout(r, 70));
    const after = snap();
    const re = new RegExp(noise);
    const changed = Object.keys(after).filter(k => after[k] !== before[k] && !re.test(k));
    return { changed: changed.slice(0, 12), n: changed.length, threw };
  }, { addr, payload, snapSrc: SNAP_FN, noise: NOISE.source });
}

async function fireOne(rig, item) {
  const payloads = item.type === 'hold' ? [[1], [0]] : [VALUES[item.addr] || []];
  let total = 0, threw = null;
  for (const p of payloads) { const r = await fireIn(rig, item.addr, p); total += r.n; threw = threw || r.threw; }
  return { total, threw };
}

async function sectionFire(state) {
  head('fire — does a valid payload change anything?');
  // AUDIT_FROM=<address substring> starts the sweep there instead of at the top,
  // which is how you find out whether a hang belongs to the address or to what
  // ran before it.
  let list = plan();
  if (process.env.AUDIT_FROM) {
    const i = list.findIndex(x => x.addr.includes(process.env.AUDIT_FROM));
    if (i > 0) { note(`starting at ${list[i].addr} (skipping ${i})`); list = list.slice(i); }
  }
  for (const item of list) {
    if (process.env.AUDIT_TRACE) console.log('    → ' + item.addr);
    const rig = await freshProbe(state);
    await seedMaterial(rig);
    const { total, threw } = await fireOne(rig, item);
    if (threw) bad(`${item.addr} threw on a valid payload: ${threw}`);
    else if (total === 0 && NEEDS_STATE.has(item.addr))
      note(`${item.addr} — quiet, ${NEEDS_STATE.get(item.addr)} (expected)`);
    else if (total === 0) bad(`${item.addr} (${item.id || 'osc-only'}) changed nothing — dead address?`);
  }
  if (!failures) ok(`all ${list.length} addresses produced an observable change`);
}

async function sectionEdges(state) {
  head('edges — does an explicit 0 fire the action a second time?');
  const doubles = [];
  for (const item of plan()) {
    if (item.type === 'hold' || VALUES[item.addr]) continue;   // 0 is meaningful for these
    const rig = await freshProbe(state);
    await seedMaterial(rig);
    await fireIn(rig, item.addr, []);                  // bang — the press edge
    const zero = await fireIn(rig, item.addr, [0]);    // what a [toggle] sends on release
    if (zero.n > 0) doubles.push(`${item.addr} → ${zero.changed.slice(0, 3).join(', ')}`);
  }
  if (doubles.length) {
    note(`${doubles.length} trigger addresses also fire on an explicit 0. A Max [toggle], [t 1 0],`);
    note('or any button that sends both edges will run these TWICE per press:');
    doubles.forEach(d => note('    ' + d));
  } else ok('no trigger address fires on the release edge');
}

async function sectionTypes(state) {
  head('types — bang / symbol onto a value address');
  const rig = await freshProbe(state);
  const bad_ = await rig.evaluate(async ({ addrs }) => {
    const S = window.__S, out = [];
    const nan = () => { const acc = []; const walk = (o, p, d) => { if (d > 1) return; for (const k of Object.keys(o)) { let v; try { v = o[k]; } catch (_) { continue; } if (typeof v === 'number' && Number.isNaN(v)) acc.push(p + k); else if (v && typeof v === 'object' && !Array.isArray(v) && d < 1 && !(v instanceof Element)) walk(v, p + k + '.', d + 1); } }; walk(S, '', 0); return acc; };
    for (const a of addrs) {
      const before = new Set(nan());
      let threw = null;
      try { window.__osc.handleOSC(a, []); } catch (e) { threw = String(e.message || e).slice(0, 70); }
      const after = nan().filter(k => !before.has(k));
      if (after.length || threw) out.push({ a, keys: after, threw });
    }
    return out;
  }, { addrs: Object.keys(VALUES) });
  if (bad_.length) {
    note(`${bad_.length} value addresses accept a bang and write NaN (clamp() passes Number(undefined) through):`);
    bad_.forEach(x => note(`    ${x.a} → ${x.threw ? 'THREW: ' + x.threw : x.keys.join(', ')}`));
  } else ok('no value address goes non-finite on a bang');
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (ONLY.includes('wiring')) sectionWiring();

  if (ONLY.some(s => ['fire', 'edges', 'types'].includes(s))) {
    // freshProbe owns the instance so it can replace it — see RECYCLE_EVERY.
    const state = { rig: null, n: 0 };
    try {
      if (ONLY.includes('fire'))  await sectionFire(state);
      if (ONLY.includes('edges')) await sectionEdges(state);
      if (ONLY.includes('types')) await sectionTypes(state);
    } finally {
      if (state.rig) await state.rig.close();
    }
  }

  console.log('\n' + (failures ? `FAIL — ${failures} problem(s)` : 'PASS'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
