#!/usr/bin/env node
/**
 * scripts/pins-audit.js — the two pin groups, and their round trip through the
 * session file.
 *
 * Runs against a real Electron instance via scripts/lib/rig.js — no setup, no
 * server, no browser download. The instance is launched muted on its own
 * profile and OSC port, so it cannot touch your presets or a live station.
 *   node scripts/pins-audit.js
 *   node scripts/rig-audit.js          # this plus the other suites, one boot
 *
 * WHY THIS SUITE EXISTS. A group owns no audio — every flag change goes
 * through pins.js applyMix(), the same path the pinned rail takes — so none of
 * the mute semantics are re-implemented here and the pin-mute engine in
 * js/composer.js still owns them. What IS covered is the two things with no
 * test anywhere else:
 *
 *  1. **Derived audibility.** A pin has `mute` and `solo`, a group has `muted`
 *     and `solo`, and whether a pin sounds is ONE function of the four
 *     (2026-09-05, js/pins.js). The behaviour the old restore rule existed for
 *     — unmuting a group must not resurrect a pin silenced by hand — falls out
 *     of that, and § C is its test. § D is solo: additive, mute wins, a pin
 *     born under a solo is silent. A mute is IMMEDIATE — never the boundary.
 *
 *  2. **The derived group.** This suite used to guard an ORDERING: v7 stored a
 *     `layerId` per hold, the rail repaints on a 6 Hz timer, and import awaits
 *     a WAV decode per loop slot — so a repaint landing mid-import could
 *     resolve imported ids against the previous session's group set and
 *     silently flatten the arrangement. Deriving the group from the pin's KIND
 *     deleted that hazard rather than guarding it (2026-08-30), and § B is now
 *     the assertion that it stayed deleted: a group is `slot.type`, nothing
 *     writes membership, and a pin cannot be moved between groups. § F drives a
 *     repaint against an import anyway, because the cheapest way to keep a
 *     fixed bug fixed is to keep running the test that caught it.
 *
 * Sections:
 *   A. Boot — module loads, the two groups exist, hooks registered.
 *   B. Membership — derived from kind, stored nowhere, unmovable.
 *   C. Derived audibility — a group mute does not resurrect a hand mute; a
 *      mute is immediate; the selected pin is one function.
 *   D. Solo — additive, on pins and on groups; mute wins.
 *   E. Round trip — the v13 payload carries each group's mute/solo and each
 *      pin's mute/solo, and applying it back reproduces the arrangement.
 *   F. Ordering — a rail repaint racing the import must not regroup pins.
 *   G. Old files — a v6 payload with no group block still imports, and a v7-v12
 *      one has its named groups discarded and its `_preLayerOn` / `_preGroupOn`
 *      read into `mute`.
 *   J. A pinned cloud owns its material — the cursor stops granulating what is
 *      inside a pinned cloud's radius, so pinning never doubles a sound.
 *   K. No reach line to a pinned cloud's material — counted at the canvas.
 *   I. Per-voicing k — each brush's material reads at its own k, including
 *      material painted with a brush that is no longer selected (#212).
 *   H. Frozen brushes — a stroke remembers the TILE that painted it, the
 *      interning that stops four strokes becoming four voicings, the v10 round
 *      trip, and the v7 migration onto the session's own embedded patch.
 *   L. Wet paint — a wet brush owns one voicing its knobs move in place, a dry
 *      brush's strokes never move, off dries where it sounds, and `wet` rides
 *      the session file only onto a rig where the tile is still wet.
 *
 *  M. The overdub brush (docs/archive/OVERDUB-PLAN.md): the nearest pinned loop is
 *     the master; the layer maths — land at phase, wrap, stack, ½× unresampled;
 *     the real record path attaches a take never armed as a trigger; undo,
 *     export/import, stopping with the master, and the refusal with no master.
 *
 * Exits non-zero on failure.
 */

const { launch } = require('./lib/rig');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else      { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

async function run(rig) {
  // Section F drives an import against a hand-held clock, and the live gate
  // runs off the real cursor at canvas centre — it will toggle a test commit
  // underneath the assertions and read as a broken restore rule rather than a
  // racing harness. Same reasoning the composer gate audit used before it was sunset.
  await rig.quiesce();

  // ── A. Boot ───────────────────────────────────────────────────────────────
  console.log('\n§ A. boot');
  const boot = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const list = P.groups();
    return {
      hasS:      !!S,
      count:     list.length,
      keys:      list.map(g => g.key),
      hues:      list.map(g => g.hue),
      anyMuted:  list.some(g => g.muted),
      anySolo:   list.some(g => g.solo),
      hookToggle: typeof S._toggleGroupOf,
      hookAllOn:  typeof S._pinsAllOn,
      hasExport:  typeof P.exportGroups,
      hasRestore: typeof P.restoreGroups,
      // The v1 group model's whole surface, which must be gone rather than
      // merely unused: a leftover S.layers is what a stale import would find.
      noLayerState: S.layers === undefined && S.layerSeq === undefined,
      noLayerHooks: S._layerForKey === undefined && S._toggleLayerOf === undefined
                    && S._layersAllOn === undefined,
    };
  });

  if (!boot.hasS) {
    console.log('  FAIL could not import js/state.js — nothing else can be checked.');
    return 1;
  }

  // Exactly two, in this order, forever: a commit slot is a cloud or a loop, so
  // a third group would mean a third kind of pin.
  check('there are exactly two groups', boot.count === 2, String(boot.count));
  check('they are cloud and loop, in that order', boot.keys.join(',') === 'cloud,loop', boot.keys.join(','));
  check('each names an ENGINE hue rather than a colour of its own',
    boot.hues.every(h => typeof h === 'string' && h.startsWith('--eng-')), JSON.stringify(boot.hues));
  check('nothing starts muted', boot.anyMuted === false);
  check('nothing starts soloed', boot.anySolo === false);
  check('S._toggleGroupOf registered', boot.hookToggle === 'function');
  check('S._pinsAllOn registered', boot.hookAllOn === 'function');
  check('persistence seam is exported', boot.hasExport === 'function' && boot.hasRestore === 'function');
  check('the named-group state is gone from S', boot.noLayerState === true);
  check('so are its hooks', boot.noLayerHooks === true);

  // ── B. Membership ─────────────────────────────────────────────────────────
  // The point of the rewrite: there is nothing to assign, so there is nothing
  // to get wrong. These assertions are deliberately about ABSENCE — a future
  // change that reintroduces stored membership will fail here first.
  console.log('\n§ B. membership — derived from kind, stored nowhere');
  const mem = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    // Hand-built slots are fine HERE: this section is about grouping, which is
    // a property of the slot object, not of how it was created. Sections C-F
    // care about audio state and say so.
    // A synthetic slot still has to be drawable, because the app keeps running
    // while the suite does: the 30 fps render loop reads `seq.particles.length`
    // (renderer.js) and the slot-bank mini-canvas reads `seq.grainParams.volume`
    // (ui-presets.js) for every `playing` slot, and either throws on a partial
    // object. No real creation or import path can produce one — import always
    // builds both — so this is the harness's job, not a guard in the hot path.
    const cloud = { type: 'cloud', slotIndex: 0, playing: true,
                    color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const loop  = { type: 'loop',  slotIndex: 1, playing: true, particles: [],
                    color: '#4fc3f7', grainParams: { volume: 1 } };
    S.commitSlots = [cloud, loop];

    const gc = P.groupOf(cloud), gl = P.groupOf(loop);
    const stable = P.groupOf(cloud) === gc;             // asking twice is the same answer
    // Nothing was written to the slot to make that true.
    const wroteNothing = !('layerId' in cloud) && !('groupId' in cloud) && !('group' in cloud);
    // The one way to change a pin's group is to change what it IS.
    cloud.type = 'loop';
    const followsKind = P.groupOf(cloud) === gl;
    cloud.type = 'cloud';
    const inClouds = P.pinsIn(gc).length, inLoops = P.pinsIn(gl).length;
    const unknown = P.groupOf({ type: 'trigger' });
    return { gcKey: gc?.key, glKey: gl?.key, stable, wroteNothing, followsKind,
             inClouds, inLoops, unknownIsNull: unknown === null,
             noAdd: P.addGroup === undefined && P.moveHoldToLayer === undefined
                    && P.moveToGroup === undefined };
  });

  check('a cloud is in the clouds group', mem.gcKey === 'cloud', String(mem.gcKey));
  check('a loop is in the loops group', mem.glKey === 'loop', String(mem.glKey));
  check('asking twice is the same answer', mem.stable === true);
  check('nothing is written to the pin to record it', mem.wroteNothing === true,
    'a stored group is the whole class of bug this replaced');
  check('the group follows the kind, because it IS the kind', mem.followsKind === true);
  check('pinsIn() finds each in its own group', mem.inClouds === 1 && mem.inLoops === 1,
    `clouds=${mem.inClouds} loops=${mem.inLoops}`);
  check('a slot that is neither kind is in no group', mem.unknownIsNull === true);
  check('there is no way to create a group or move a pin between them', mem.noAdd === true);

  // The ghost pin (BRUSH-MODEL § 3e v4m): pinning with NOTHING in reach is a
  // strategy, not an error — the press pins a cloud at the cursor, and scratch
  // painted into its radius later is picked up because a cloud stores a place
  // and re-reads the live pool every tick. This goes through the REAL
  // plantSeed() path with an empty particle pool, because the cloud-not-loop
  // choice lives in the gesture's fallthrough and a hand-built slot would
  // assert nothing.
  const ghost = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const UP = await import('./js/ui-presets.js');
    const keepSlots = S.commitSlots.slice();
    const keepParts = S.particles;
    S.commitSlots = new Array(keepSlots.length).fill(null);
    S.particles = [];
    UP.plantSeed();
    const slot = S.commitSlots.find(c => c);
    const type = slot?.type ?? null;
    S.commitSlots = keepSlots;
    S.particles = keepParts;
    return { type };
  });
  check('a pin over nothing is a cloud — the ghost pin', ghost.type === 'cloud', String(ghost.type));

  // ── C. Derived audibility ─────────────────────────────────────────────────
  // Two pins in one group, one of them muted by hand; mute the group, unmute
  // it, and only the one that was sounding may come back. Under the derived
  // model that is not a rule to remember but a consequence: the hand mute is
  // still set.
  console.log('\n§ C. derived audibility — unmuting a group does not resurrect what you muted');
  const restore = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const C = await import('./js/composer.js');
    P.restoreGroups([]);                              // both groups live

    // Drawable — see § B on why a partial slot crashes the live render loop.
    const a = { type: 'cloud', slotIndex: 0, playing: true,
                color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const b = { type: 'cloud', slotIndex: 1, playing: true,
                color: '#e8a030', grainParams: {}, grainOverrides: {} };
    S.commitSlots = [a, b];
    const g = P.groupOf(a);

    C.toggleCommit(b);                           // mute ONE by hand
    const beforeA = C.isCommitOn(a), beforeB = C.isCommitOn(b);
    const bFlag = b.mute === true && a.mute !== true;

    P.setGroupMuted(g, true);
    const mutedA = C.isCommitOn(a), mutedB = C.isCommitOn(b);
    const flagMuted = g.muted;
    // The group going down did not touch the pin's own flag either way.
    const flagsHeld = b.mute === true && a.mute !== true;

    P.setGroupMuted(g, false);
    const afterA = C.isCommitOn(a), afterB = C.isCommitOn(b);

    // A hand unmute under a muted group changes the flag, not the sound.
    P.setGroupMuted(g, true);
    P.setPinMuted(b, false);
    const stillSilent = C.isCommitOn(b) === false && b.mute === false;
    P.setGroupMuted(g, false);
    const thenSounds = C.isCommitOn(b) === true;

    // Nothing else about silence is stored on the slot.
    const noBookkeeping = !('_preGroupOn' in a) && !('_preGroupOn' in b);

    return { beforeA, beforeB, bFlag, mutedA, mutedB, flagMuted, flagsHeld, afterA, afterB,
             stillSilent, thenSounds, noBookkeeping, audibleFn: typeof P.isPinAudible };
  });

  check('isPinAudible() is the one function', restore.audibleFn === 'function');
  check('one pin muted by hand, the other sounding', restore.beforeA === true && restore.beforeB === false,
    `A=${restore.beforeA} B=${restore.beforeB}`);
  check('the hand mute is the pin\'s own flag', restore.bFlag === true);
  check('muting the group silences everything in it', restore.mutedA === false && restore.mutedB === false,
    `A=${restore.mutedA} B=${restore.mutedB}`);
  check('the group records itself muted', restore.flagMuted === true);
  check('and leaves the pins\' own flags alone', restore.flagsHeld === true);
  check('unmuting brings back ONLY what was sounding', restore.afterA === true && restore.afterB === false,
    `A=${restore.afterA} B=${restore.afterB} — B was muted by hand and must stay silent`);
  check('unmuting a pin under a muted group changes the flag, not the sound', restore.stillSilent === true);
  check('and it sounds once the group comes back', restore.thenSounds === true);
  check('no restore bookkeeping is stored on the slot', restore.noBookkeeping === true);

  // ── The MIX toggle, and the two ways it lied (2026-09-15) ────────────────
  // Ek: "when i click the mute button the mix it only flashes every two clicks,
  // doesn't seem to engage. it seems to work as expected when the pin mute tile
  // is in the palette bar." Two independent faults under one symptom, so two
  // invariants.
  //
  // ONE: allMuted() asked `GROUPS.every(g => g.muted)` over a STATIC pair, while
  // pruneEmptyGroups — which runs inside the applyMix() that setAllMuted itself
  // calls — clears the flag on every group holding no pins. So with clouds
  // pinned and no loops, the answer was false the instant it was set. That made
  // `pins_mute` with no value a one-way trip: `!allMuted()` was always true, so
  // a bang, a pad or a key muted and never let go.
  const mixToggle = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    P.restoreGroups([]);
    // ONE group populated — the ordinary case, and the one that was broken.
    const cloud = { type: 'cloud', slotIndex: 0, playing: true,
                    color: '#e8a030', grainParams: {}, grainOverrides: {} };
    S.commitSlots = [cloud];
    const empty = P.allMuted();
    P.setAllMuted(true);
    const onFlag = P.groupOf(cloud).muted, onRead = P.allMuted(), onAudible = P.isPinAudible(cloud);
    P.setAllMuted(false);
    const offRead = P.allMuted(), offAudible = P.isPinAudible(cloud);
    // The flip the OSC / MIDI road takes, twice: it must round-trip.
    P.setAllMuted(!P.allMuted()); const flip1 = P.allMuted();
    P.setAllMuted(!P.allMuted()); const flip2 = P.allMuted();
    // Nothing pinned at all is not "everything is muted".
    S.commitSlots = [];
    P.setAllMuted(true);
    const nothingPinned = P.allMuted();
    return { empty, onFlag, onRead, onAudible, offRead, offAudible, flip1, flip2, nothingPinned };
  });

  check('nothing is muted to begin with', mixToggle.empty === false);
  check('mute all silences the group that holds the pins', mixToggle.onFlag === true && mixToggle.onAudible === false,
    `flag=${mixToggle.onFlag} audible=${mixToggle.onAudible}`);
  check('and allMuted() says so with the OTHER group empty', mixToggle.onRead === true,
    `${mixToggle.onRead} — it counted a static pair, so an empty group read as not-muted`);
  check('letting go brings the sound back', mixToggle.offRead === false && mixToggle.offAudible === true,
    `read=${mixToggle.offRead} audible=${mixToggle.offAudible}`);
  check('the bare flip round-trips, so a bang is not one-way', mixToggle.flip1 === true && mixToggle.flip2 === false,
    `${mixToggle.flip1} then ${mixToggle.flip2} — both true means mute with no value can never let go`);
  check('nothing pinned is not "everything muted"', mixToggle.nothingPinned === false);

  // TWO: the rail row flashed. _pinFlash ends in a 180 ms timeout that removes
  // `.fired` from the very elements _pinLit had just lit, so mute engaged and
  // then went dark; on the release press _pinLit(false) beat the timeout and no
  // flash showed at all — "only flashes every two clicks". A SUSTAINED control
  // lights and HOLDS; only a bang flashes. Measured past the timeout, or the
  // check cannot tell the two apart.
  const railLight = await rig.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    // A DRAWABLE FAKE SLOT, not plantSeed (2026-09-15). The rail renders from
    // S.commitSlots, so a slot is all this needs — and plantSeed costs a real
    // take, a sealed buffer and a history entry, which made § I's undo counts
    // fail on roughly one run in three. § B says why a partial slot crashes the
    // live render loop; this carries the same fields § C's do.
    const keep = { slots: S.commitSlots.slice() };
    try {
      P.restoreGroups([]);
      const pin = { type: 'cloud', slotIndex: 0, playing: true,
                    color: '#e8a030', grainParams: {}, grainOverrides: {} };
      S.commitSlots = [pin];
      S._pinsDirty = true; await sleep(350);
      const row = document.querySelector('#tcPins [data-pin="mute"]');
      if (!row) return { row: false };
      const seen = [];
      for (let i = 0; i < 4; i++) {
        row.click();
        await sleep(260);                     // PAST the 180 ms flash timeout
        seen.push({ lit: row.classList.contains('fired'), muted: P.allMuted(),
                    audible: P.isPinAudible(pin) });
      }
      return { row: true, seen };
    } finally {
      S.commitSlots = keep.slots;
      P.restoreGroups([]); P.applyMix();
      S._pinsDirty = true; await sleep(120);
    }
  });

  check('the rail has a mute row', railLight.row === true);
  if (railLight.row) {
    const s4 = railLight.seen;
    check('the rail row HOLDS its light past the flash window',
      s4[0].lit === true && s4[2].lit === true,
      s4.map(x => x.lit).join(',') + ' — a flash is dark again by 260 ms');
    check('the rail row alternates, so every click engages',
      s4[0].muted === true && s4[1].muted === false && s4[2].muted === true && s4[3].muted === false,
      s4.map(x => x.muted).join(','));
    check('the light says what the sound is doing, every press',
      s4.every(x => x.lit === x.muted && x.audible === !x.muted),
      s4.map(x => `lit=${x.lit}/muted=${x.muted}/audible=${x.audible}`).join(' '));
  }

  // A group mute must not reach across the kinds — that is the entire feature.
  const across = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const C = await import('./js/composer.js');
    P.restoreGroups([]);
    const cloud = { type: 'cloud', slotIndex: 0, playing: true,
                    color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const loop  = { type: 'loop',  slotIndex: 1, playing: true, particles: [],
                    color: '#4fc3f7', grainParams: { volume: 1 } };
    S.commitSlots = [cloud, loop];
    P.setGroupMuted(P.groupOf(cloud), true);
    const r = { cloudOff: C.isCommitOn(cloud) === false, loopStillOn: C.isCommitOn(loop) === true };
    P.setGroupMuted(P.groupOf(cloud), false);
    return r;
  });
  check('muting the clouds silences the clouds', across.cloudOff === true);
  check('and leaves the loops sounding', across.loopStillOn === true);

  // A MUTE IS IMMEDIATE (2026-09-05). Before, the rail's mute landed at the
  // loop boundary — that is a release, and the word was doing two jobs. A
  // muted loop's mute node ramps NOW; a muted cloud stops scheduling NOW,
  // whatever its fade out says. The loop is a real one, built by the
  // scheduler, so the ramp is scheduled on a live node.
  const imm = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const C = await import('./js/composer.js');
    const P = await import('./js/pins.js');
    P.restoreGroups([]);
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    // A cloud with a LONG fade out: the mute must not ride it.
    S.commitRelease = 5;
    const cl = { type: 'cloud', slotIndex: 0, playing: true, lon: 0, lat: 0,
                 color: '#e8a030', grainParams: {}, grainOverrides: {}, _releasingAt: 0 };
    S.commitSlots[0] = cl;
    P.setPinMuted(cl, true);
    const cloudNow = cl.playing === false && !(cl._releasingAt > 0) && cl._composerHold === true;
    P.setPinMuted(cl, false);
    const cloudBack = cl.playing === true && cl._composerHold === false;
    S.commitRelease = 0;

    // A loop with a live mute node: the ramp lands within the 20 ms ramp, not
    // at the end of a pass. Fake the node the way grain.js builds it.
    const actx = S.audioCtx;
    if (!actx) return { cloudNow, cloudBack, noCtx: true };
    const mute = actx.createGain();
    // A node nobody renders never advances its automation: the ramp lands
    // only on a node in the graph. No input, so it is silent at the output.
    mute.connect(actx.destination);
    const lp = { type: 'loop', slotIndex: 1, playing: true, particles: [], speed: 1,
                 loopStart: 0, loopEnd: 4, _startedAt: actx.currentTime - 0.5,
                 color: '#4fc3f7', grainParams: { volume: 1 }, _muteGain: mute };
    S.commitSlots[1] = lp;
    const t0 = actx.currentTime;
    P.setPinMuted(lp, true);
    await new Promise(r => setTimeout(r, 80));
    const g = mute.gain.value;
    const landed = g < 0.05;                       // 3.5 s of the pass were left
    const flag = lp.composerMuted === true;
    const noWait = !lp._muteAtTime;
    P.setPinMuted(lp, false);
    await new Promise(r => setTimeout(r, 80));
    const back = mute.gain.value > 0.95;
    try { mute.disconnect(); } catch (_) {}
    S.commitSlots[1] = null; S.commitSlots[0] = null;
    return { cloudNow, cloudBack, landed, flag, noWait, back, g, dt: actx.currentTime - t0 };
  });
  check('a muted cloud stops now, whatever its fade out says', imm.cloudNow === true);
  check('and comes back now', imm.cloudBack === true);
  if (imm.noCtx) {
    console.log('  skip  loop ramp — no audio context in the audit profile');
  } else {
    check('a muted loop\'s gain lands within the ramp, not at the pass end', imm.landed === true,
      `gain=${imm.g?.toFixed(3)} after ${imm.dt?.toFixed(3)}s with 3.5 s of the pass left`);
    check('the engine flag is set', imm.flag === true);
    check('nothing is scheduled for the boundary', imm.noWait === true);
    check('unmute is immediate too', imm.back === true);
  }

  // FOCUS REACHES THE LOOPS. The pin weight is computed for loops as well as
  // clouds and applied to the loop's own `_pinGain` node every tick — through
  // a REAL loop the scheduler builds, because the apply line sat in a
  // try/catch that swallowed a ReferenceError for weeks (grain.js read an
  // `actx` declared in a later block): the weight was right, the gain never
  // left 1, and nothing but a measurement could have said so (2026-09-05).
  const foc = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const G = await import('./js/grain.js');
    const SP = await import('./js/sphere.js');
    P.restoreGroups([]);
    const actx = S.audioCtx;
    if (!actx) return { noCtx: true };
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    // The scheduler's own cursor (no sensor, no mouse in the audit profile),
    // so "on the anchor" is exact rather than a frame behind.
    const cur = SP.getCursorLonLat();
    // The suite quiesced the scheduler, so drive it by hand: the weight pass
    // and the loop's node build are both scheduleGrains().
    const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);   // 1 s of silence
    const mk = k => ({ lon: cur.lon + 0.02 * k, lat: cur.lat, grainStart: 0.25 * k, grainDuration: 0.2 });
    const loop = { type: 'loop', slotIndex: 0, strokeId: 998, particles: [0, 1, 2, 3].map(mk), buffer: buf,
      loopStart: 0, loopEnd: 1, playheadIndex: 0, startOffset: 0, direction: 1, speed: 1, playing: true,
      color: '#4fc3f7', anchorLon: cur.lon, anchorLat: cur.lat, _sourceNode: null, _gainNode: null,
      _regionBuf: null, _createdAt: performance.now() / 1000, _startedAt: 0, grainParams: { volume: 1 },
      mute: false, solo: false };
    const cloud = { type: 'cloud', slotIndex: 1, playing: true, lon: cur.lon + 6 * Math.PI / 180, lat: cur.lat,
      color: '#e8a030', grainParams: { ...S.grainParams }, grainOverrides: {}, searchRadiusDeg: 10,
      _lastFiredAt: 0, _nextPeriodMs: 0, _plantedAt: performance.now() / 1000, _releasingAt: 0,
      _envAttack: 0, _envRelease: 0, _envGainCurrent: 1, morphT: 0.5, morphVelocity: 0,
      frames: null, duration: 0, loopMode: 'pingpong', mute: false, solo: false };
    S.commitSlots[0] = loop; S.commitSlots[1] = cloud;
    const was = { mode: S.commitPlayback, tether: S.commitTether, xf: S.commitXfade, r: S.searchRadiusDeg };
    const settle = async () => {
      for (let i = 0; i < 12; i++) { G.scheduleGrains(); await new Promise(r => setTimeout(r, 25)); }
    };
    // The cursor sits between the two, 3° from each: an even split at any
    // crossfade width. Then the loop's anchor moves under the cursor: alone.
    const D = Math.PI / 180;
    loop.anchorLon = cur.lon - 3 * D; cloud.lon = cur.lon + 3 * D;
    S.commitPlayback = 'focus'; S.commitTether = true; S.commitXfade = 1; S.searchRadiusDeg = 10;
    await settle();
    const shared = { w: S._pinWeights[0], g: loop._pinGain?.gain.value, src: !!loop._sourceNode };
    S.commitXfade = 0.5;
    loop.anchorLon = cur.lon; loop.anchorLat = cur.lat;      // ON the anchor
    await settle();
    const onA = { w: S._pinWeights[0], other: S._pinWeights[1], g: loop._pinGain?.gain.value };
    S.commitXfade = 1;
    await settle();
    const onA1 = { other: S._pinWeights[1] };
    loop.anchorLon = cur.lon + 30 * D; S.commitTether = false;
    await settle();
    const out = { w: S._pinWeights[0], g: loop._pinGain?.gain.value };
    S.commitPlayback = 'all';
    await settle();
    const flat = { w: S._pinWeights[0], g: loop._pinGain?.gain.value };
    S.commitPlayback = was.mode; S.commitTether = was.tether; S.commitXfade = was.xf; S.searchRadiusDeg = was.r;
    S.commitSlots.fill(null);
    return { shared, onA, onA1, out, flat };
  });
  if (foc.noCtx) {
    console.log('  skip  focus reaches the loops — no audio context in the audit profile');
  } else {
    const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.03;
    check('the scheduler built the loop', foc.shared.src === true);
    check('midway between a loop and a cloud the mix is even',
      near(foc.shared.w, 0.5), `w=${foc.shared.w?.toFixed(3)}`);
    check('and the loop\'s pin gain IS its share', near(foc.shared.g, foc.shared.w),
      `gain=${foc.shared.g?.toFixed(3)} weight=${foc.shared.w?.toFixed(3)}`);
    // Ek, 2026-09-05: "if I'm completely on top of the other loop I shouldn't
    // hear the other pinned loop at all" — at any crossfade width.
    check('on the loop\'s anchor it is alone at xfade 50 %', near(foc.onA.w, 1) && near(foc.onA.other, 0) && near(foc.onA.g, 1),
      `w=${foc.onA.w?.toFixed(3)} other=${foc.onA.other?.toFixed(3)} gain=${foc.onA.g?.toFixed(3)}`);
    // At the widest crossfade the hand is never EXACTLY on the anchor — the
    // scheduler reads its own cursor a tick later — so the smoothstep's floor
    // is asked for −26 dB, not for zero (it read 0.031 once, 2026-09-06). The
    // bug this guards is a partial MIX, 0.2 or 0.5, which is orders away.
    check('and at xfade 100 %', foc.onA1.other < 0.05, `other=${foc.onA1.other?.toFixed(3)}`);
    check('out of reach with tether off, the loop is silent', near(foc.out.g, 0) && foc.out.w === 0,
      `gain=${foc.out.g?.toFixed(3)} weight=${foc.out.w}`);
    check('blend "all" puts it back to 1', near(foc.flat.g, 1), `gain=${foc.flat.g?.toFixed(3)}`);
  }

  // AN ANCHOR IS WHERE THE GESTURE RELEASED (Ek, 2026-09-05: "an anchor is an
  // anchor, it should not move … the anchor should be placed at the end of
  // the path"). A moving cloud's distance for the focus law is to its anchor
  // — stamped at the END of its path by the seal — never to the position the
  // scheduler writes into `lon` every tick. Every reader goes through
  // pins.js pinAnchorInto; the weight pass was the one that followed the cloud.
  const mvc = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const G = await import('./js/grain.js');
    const UP = await import('./js/ui-presets.js');
    const SP = await import('./js/sphere.js');
    P.restoreGroups([]);
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    const cur = SP.getCursorLonLat();
    const D = Math.PI / 180;
    const fr = (t, lon) => ({ t, lon, lat: cur.lat, grainParams: { ...S.grainParams }, searchRadiusDeg: 10,
      nearestMode: false, kAllMode: 'all', kSeqMode: 'all', grainDirection: 'fwd', grainCurveType: 'sine',
      grainProbability: 1, radiusFadeEnabled: false, radiusFadeCurve: 0.5 });

    // 1. The REAL seal: a deferred path (the wash's road, and the held pin's)
    //    drawn from 60° east to 3° east, released there. The slot it makes
    //    must be anchored at the END.
    const wasOverflow = S.commitOverflow;
    S._commitRecordingFrames   = [fr(0, cur.lon + 60 * D), fr(2000, cur.lon + 30 * D), fr(4000, cur.lon + 3 * D)];
    S._commitRecordingStart    = performance.now() - 4000;
    S._commitRecordingSlot     = -1;
    S._commitRecordingDeferred = true;
    S._commitRecordingStrokeId = -1;
    UP.finalizeSeedPlant();
    const sealed = S.commitSlots.find(c => c && c.type === 'cloud');
    const sealedAnchorDeg = sealed ? (sealed.anchorLon - cur.lon) / D : null;
    const sealedMoving = !!(sealed && sealed.frames && sealed.frames.length === 3);
    const acc = [0, 0]; P.pinAnchorInto(sealed, acc);
    const accessorDeg = (acc[0] - cur.lon) / D;

    // 2. The focus law reads that anchor while the scheduler moves the cloud.
    const still = { type: 'cloud', slotIndex: 1, playing: true, lon: cur.lon - 3 * D, lat: cur.lat, color: '#e8a030',
      grainParams: { ...S.grainParams }, grainOverrides: {}, searchRadiusDeg: 10, nearestMode: false,
      _lastFiredAt: 0, _nextPeriodMs: 0, _plantedAt: performance.now() / 1000, _releasingAt: 0,
      _envAttack: 0, _envRelease: 0, _envGainCurrent: 1, morphT: 0.5, morphVelocity: 0,
      frames: null, duration: 0, loopMode: 'pingpong', mute: false, solo: false, anchorLon: cur.lon - 3 * D, anchorLat: cur.lat };
    S.commitSlots.fill(null); S.commitSlots[0] = sealed; S.commitSlots[1] = still;
    sealed._playheadMs = 1000; sealed.loopMode = 'forward';    // mid-path: ~45° east right now
    const was = { mode: S.commitPlayback, tether: S.commitTether, xf: S.commitXfade, r: S.searchRadiusDeg };
    S.commitPlayback = 'focus'; S.commitTether = true; S.commitXfade = 1; S.searchRadiusDeg = 10;
    for (let i = 0; i < 6; i++) { G.scheduleGrains(); await new Promise(r => setTimeout(r, 25)); }
    const w = [S._pinWeights[0], S._pinWeights[1]];
    const nowDeg = (sealed.lon - cur.lon) / D;                  // the scheduler moved it
    S.commitPlayback = was.mode; S.commitTether = was.tether; S.commitXfade = was.xf; S.searchRadiusDeg = was.r;
    S.commitOverflow = wasOverflow;
    S.commitSlots.fill(null);
    return { sealedAnchorDeg, sealedMoving, accessorDeg, w, nowDeg };
  });
  check('the seal makes a moving cloud', mvc.sealedMoving === true);
  check('and anchors it at the END of its path, where the hand let go',
    Math.abs(mvc.sealedAnchorDeg - 3) < 0.01, `anchor ${mvc.sealedAnchorDeg?.toFixed(2)}° east, path ended at 3°`);
  check('pinAnchorInto reads that anchor', Math.abs(mvc.accessorDeg - 3) < 0.01, `${mvc.accessorDeg?.toFixed(2)}°`);
  check('the scheduler is moving the cloud away from it', Math.abs(mvc.nowDeg - 3) > 15,
    `now ${mvc.nowDeg?.toFixed(1)}° east`);
  check('the focus law measures from the anchor — even with a still cloud 3° west',
    Math.abs(mvc.w[0] - 0.5) < 0.03 && Math.abs(mvc.w[1] - 0.5) < 0.03,
    `w=${mvc.w.map(v => v?.toFixed(3)).join(' / ')} — following the cloud would give ≈ 0.04 / 0.96`);

  // THE LOOP HALF OF THE RULE, through the real road (Ek, 2026-09-05: "I just
  // tested with the looper brush and the anchor point is still at the
  // beginning of the stroke" — the slot takes the PAYLOAD's anchor, and
  // buildLoopPayload said `seqParticles[0]` whatever _resolveStrokeAnchor
  // said). A painted stroke over a real live buffer, pinned the way the
  // looper pins it (no hand particle): anchored at its LAST mark. Pinned as
  // a drop (a hand particle): anchored at the hand.
  const lpa = await rig.evaluate(async () => {
    const T = await import('./js/take.js');
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const UP = await import('./js/ui-presets.js');
    const actx = S.audioCtx;
    if (!actx) return { noCtx: true };
    const keepParts = S.particles, keepSlots = S.commitSlots.slice(), keepLive = S.liveRecBuffers.slice();
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    const buf = T.makeTake(new Float32Array(actx.sampleRate), actx.sampleRate);          // 1 s of silence
    S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
    const idx = S.liveRecBuffers.length - 1;
    const D = Math.PI / 180, sid = 424242;
    const marks = [0, 1, 2, 3, 4].map(k => ({ lon: 0.3 + k * 5 * D, lat: 0.1, strokeId: sid, source: 'live',
      liveBufferIdx: idx, grainStart: 0.15 * k, grainDuration: 0.12, color: '#fff' }));
    S.particles = marks.slice();
    UP.createSeqFromStroke(sid);                                   // the looper's road: no hand
    const byBrush = S.commitSlots.find(c => c && c.type === 'loop');
    const acc = [0, 0]; P.pinAnchorInto(byBrush, acc);
    const brushAnchorDeg = (acc[0] - 0.3) / D;
    S.commitSlots.fill(null);
    UP.createSeqFromStroke(sid, marks[1]);                          // a drop: the hand's mark
    const byHand = S.commitSlots.find(c => c && c.type === 'loop');
    P.pinAnchorInto(byHand, acc);
    const handAnchorDeg = (acc[0] - 0.3) / D;
    for (const c of S.commitSlots) if (c && c.type === 'loop') { try { UP.__testStopSeq?.(c); } catch (_) {} }
    S.commitSlots = keepSlots; S.particles = keepParts; S.liveRecBuffers = keepLive;
    return { made: !!byBrush, brushAnchorDeg, handAnchorDeg };
  });
  if (lpa.noCtx) {
    console.log('  skip  looper anchor — no audio context in the audit profile');
  } else {
    check('a painted stroke pins as a loop through the real road', lpa.made === true);
    check('pinned by the brush, it is anchored at its LAST mark', Math.abs(lpa.brushAnchorDeg - 20) < 0.01,
      `anchor ${lpa.brushAnchorDeg?.toFixed(2)}° along a 0–20° stroke`);
    check('pinned by a drop, it is anchored at the hand', Math.abs(lpa.handAnchorDeg - 5) < 0.01,
      `anchor ${lpa.handAnchorDeg?.toFixed(2)}°, the hand was at 5°`);
  }

  // THE SELECTED PIN: what unpin takes and what the rail marks, one function.
  const selp = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    P.restoreGroups([]);
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    const near = { type: 'cloud', slotIndex: 0, playing: true, lon: 0.1, lat: 0, _plantedAt: 200,
                   color: '#e8a030', grainParams: {}, grainOverrides: {}, _releasingAt: 0 };
    const old  = { type: 'loop', slotIndex: 1, playing: true, particles: [], anchorLon: 2, anchorLat: 0,
                   _createdAt: 100, color: '#4fc3f7', grainParams: { volume: 1 } };
    const gone = { type: 'loop', slotIndex: 2, playing: true, particles: [], anchorLon: 0, anchorLat: 0,
                   _createdAt: 50, _fadingOut: true, color: '#4fc3f7', grainParams: { volume: 1 } };
    S.commitSlots[0] = near; S.commitSlots[1] = old; S.commitSlots[2] = gone;
    const was = S.selectionMode;
    S.selectionMode = 'nearest';
    const n = P.selectedPinSlot(0, 0);
    S.selectionMode = 'oldest';
    const o = P.selectedPinSlot(0, 0);
    S.selectionMode = 'farthest';
    const f = P.selectedPinSlot(0, 0);
    S.selectionMode = was;
    S.commitSlots.fill(null);
    return { n, o, f, hook: typeof S._selectedPinSlot };
  });
  check('nearest picks the pin nearest the cursor, skipping one on its way out', selp.n === 0, String(selp.n));
  check('oldest picks the one pinned first, skipping one on its way out', selp.o === 1, String(selp.o));
  check('farthest picks the pin farthest from the cursor (Ek, 2026-09-06), skipping one on its way out', selp.f === 1, String(selp.f));
  check('the renderer and the rail read the same hook', selp.hook === 'function');

  // ── D. Solo ───────────────────────────────────────────────────────────────
  console.log('\n§ D. solo — additive, on pins and on groups; mute wins');
  const solo = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const C = await import('./js/composer.js');
    P.restoreGroups([]);
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    const c1 = { type: 'cloud', slotIndex: 0, playing: true, color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const c2 = { type: 'cloud', slotIndex: 1, playing: true, color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const l1 = { type: 'loop',  slotIndex: 2, playing: true, particles: [], color: '#4fc3f7', grainParams: { volume: 1 } };
    S.commitSlots[0] = c1; S.commitSlots[1] = c2; S.commitSlots[2] = l1;
    const on = () => [c1, c2, l1].map(c => C.isCommitOn(c) ? 1 : 0).join('');
    const [cl, lp] = P.groups();

    P.togglePinSolo(c1);
    const onlyC1 = on();                          // 100
    P.togglePinSolo(l1);
    const c1AndL1 = on();                         // 101 — additive
    P.setPinMuted(c1, true);
    const muteWins = on();                        // 001
    P.setPinMuted(c1, false);
    P.togglePinSolo(c1); P.togglePinSolo(l1);
    const cleared = on();                         // 111

    P.toggleSolo(cl);
    const cloudsOnly = on();                      // 110
    const groupFlags = cl.solo && !lp.solo && !lp.muted;   // the other group is NOT written muted
    P.toggleSolo(lp);
    const both = on();                            // 111 — soloing both is everything
    P.toggleSolo(cl); P.toggleSolo(lp);
    const groupCleared = on();

    // A pin born under a solo is silent from its first tick.
    P.togglePinSolo(c1);
    const c3 = { type: 'cloud', slotIndex: 3, playing: true, color: '#e8a030', grainParams: {}, grainOverrides: {} };
    S.commitSlots[3] = c3;
    P.applyMix();
    const bornSilent = C.isCommitOn(c3) === false && c3.mute !== true;
    P.allOn();
    const allOn = on() === '111' && C.isCommitOn(c3) && P.everythingOn();
    S.commitSlots.fill(null);
    return { onlyC1, c1AndL1, muteWins, cleared, cloudsOnly, groupFlags, both, groupCleared, bornSilent, allOn };
  });

  check('soloing one pin silences every other pin, both kinds', solo.onlyC1 === '100', solo.onlyC1);
  check('a second solo adds to it', solo.c1AndL1 === '101', solo.c1AndL1);
  check('mute wins over solo on the same pin', solo.muteWins === '001', solo.muteWins);
  check('clearing the solos restores everything', solo.cleared === '111', solo.cleared);
  check('a group solo is that kind only', solo.cloudsOnly === '110', solo.cloudsOnly);
  check('and it does not write the other group muted', solo.groupFlags === true);
  check('soloing both groups is everything', solo.both === '111', solo.both);
  check('clearing the group solos restores everything', solo.groupCleared === '111', solo.groupCleared);
  check('a pin born under a solo is silent, with its own mute unset', solo.bornSilent === true);
  check('all on clears every flag everywhere', solo.allOn === true);

  // ── E. Round trip ─────────────────────────────────────────────────────────
  console.log('\n§ E. v13 round trip — the arrangement survives export/import');
  const trip = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const X = await import('./js/piece.js');
    P.restoreGroups([]);

    // A muted group holding a pin muted by hand, and a live group beside it
    // with a soloed pin — the flags that have to come back exactly.
    const a = { type: 'cloud', slotIndex: 0, playing: true, lon: 10, lat: 5,
                color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const b = { type: 'loop', slotIndex: 1, playing: true, particles: [], lon: 20, lat: 5,
                anchorLon: 20, anchorLat: 5, color: '#4fc3f7', grainParams: { volume: 1 } };
    S.commitSlots = [a, b];
    P.setPinMuted(a, true);
    P.setPinSolo(b, true);
    P.setGroupMuted(P.groupOf(a), true);

    const built   = X.__testBuildPiece();
    const payload = JSON.parse(JSON.stringify(built.manifest));
    const wire = payload.live?.pinGroups;
    const slotA = payload.commits?.[0];
    const noMembership = payload.commits.every(c => !c || !('layerId' in c));

    // Wipe memory the way a fresh launch would, then import.
    P.restoreGroups([]);
    S.commitSlots = [];
    await X.__testApplyPiece(payload, built.audio);

    const [clBack, lpBack] = P.groups();
    const rb = S.commitSlots[0], rbB = S.commitSlots[1];

    return {
      version:    payload._version,
      wireKeys:   Array.isArray(wire) ? wire.map(g => g.key).join(',') : null,
      wireMuted:  Array.isArray(wire) ? wire.find(g => g.key === 'cloud')?.muted : null,
      noMembership,
      slotMute:   slotA?.mute, slotSolo: payload.commits?.[1]?.solo,
      noPre:      payload.commits.every(c => !c || !('_preGroupOn' in c)),
      noLayerSet: payload.live?.layers === undefined,
      cloudsMuted: clBack?.muted,
      loopsLive:   lpBack?.muted === false,
      rbGroup:     P.groupOf(rb)?.key,
      rbMute:      rb?.mute, rbSolo: rbB?.solo,
      rbSilent:    P.isPinAudible(rb) === false,
    };
  });

  // Pinned deliberately: a bump must be a decision, and this is the assertion
  // that makes someone come and look at whether the pins half still holds.
  // v14 (2026-09-07): `filterQ` split into `hpfQ` / `lpfQ`. Looked: a pin's
  // `grainParams` is a grain block like any other and goes through
  // `migrateBlockKeys` on the way in, so a v13 file's shared Q arrives on both
  // corners — the same filter it had. The pins half is unchanged.
  check('the piece is v1', trip.version === 1, String(trip.version));
  check('the two groups are on the wire', trip.wireKeys === 'cloud,loop', String(trip.wireKeys));
  check('a muted group is written muted', trip.wireMuted === true, String(trip.wireMuted));
  check('no pin carries a stored group', trip.noMembership === true,
    'membership is derived — writing it back would resurrect the v7 hazard');
  check('the named layer set is gone from the file', trip.noLayerSet === true);
  check('a pin\'s mute and solo are on the wire', trip.slotMute === true && trip.slotSolo === true,
    `mute=${trip.slotMute} solo=${trip.slotSolo}`);
  check('the old restore flag is not', trip.noPre === true);
  check('the clouds come back MUTED, not sounding', trip.cloudsMuted === true, String(trip.cloudsMuted));
  check('the loops come back live', trip.loopsLive === true, String(trip.loopsLive));
  check('a pin is in its kind\'s group with nothing restored', trip.rbGroup === 'cloud', String(trip.rbGroup));
  check('the pin flags survive the trip', trip.rbMute === true && trip.rbSolo === true,
    `mute=${trip.rbMute} solo=${trip.rbSolo}`);
  check('and the hand-muted pin comes back silent', trip.rbSilent === true);

  // ── F. Ordering ───────────────────────────────────────────────────────────
  // The failure the v7 early-restore existed to prevent, run against the model
  // that cannot have it. Simulate what the 6 Hz rail does — walk every slot
  // through groupOf() — while an import is mid-flight. There is no id to
  // resolve, so a repaint can only ever read the pin's own kind.
  console.log('\n§ F. ordering — a rail repaint racing the import must not regroup pins');
  const order = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    const X = await import('./js/piece.js');
    P.restoreGroups([]);

    const a = { type: 'loop', slotIndex: 0, playing: true, particles: [], lon: 0, lat: 0,
                anchorLon: 0, anchorLat: 0, color: '#4fc3f7', grainParams: { volume: 1 } };
    S.commitSlots = [a];
    P.setGroupMuted(P.groupOf(a), true);
    const built   = X.__testBuildPiece();
    const payload = JSON.parse(JSON.stringify(built.manifest));

    // Leave memory holding the OPPOSITE flags, as a previous session would.
    P.restoreGroups([{ key: 'cloud', muted: true, solo: true }, { key: 'loop', muted: false }]);
    S.commitSlots = [];

    const importing = X.__testApplyPiece(payload, built.audio);
    // Repaint pressure while the import is mid-flight — the rail's own read.
    const spin = setInterval(() => {
      try { for (const c of S.commitSlots) if (c) P.groupOf(c); } catch (_) {}
    }, 4);
    await importing;
    clearInterval(spin);
    for (const c of S.commitSlots) if (c) P.groupOf(c);

    const [cl, lp] = P.groups();
    const rb = S.commitSlots[0];
    return {
      rbGroup: P.groupOf(rb)?.key,
      loopsMuted: lp.muted,
      cloudsClean: cl.muted === false && cl.solo === false,   // the stale flags are replaced
    };
  });

  check('a pin keeps its group despite repaints during import', order.rbGroup === 'loop', String(order.rbGroup));
  check('the imported mute lands on the right group', order.loopsMuted === true, String(order.loopsMuted));
  check('the previous session\'s flags are replaced, not merged', order.cloudsClean === true);

  // ── G. restoreGroups takes what it is given ───────────────────────────────
  // The version-ageing half of this section went with the old session format
  // (2026-09-14): a piece is v1, nothing older is read, and there is no
  // migration left to assert. What remains is what a hand-edited or truncated
  // file can still hand restoreGroups.
  console.log('\n§ G. restoreGroups takes what it is given');
  const old = await rig.evaluate(async () => {
    const P = await import('./js/pins.js');
    P.restoreGroups([{ key: 'cloud', muted: true }]);
    const partial = P.groups().map(g => `${g.key}:${g.muted ? 'm' : '-'}`).join(',');
    P.restoreGroups([{ key: 'nope', muted: true }]);
    const unknownIgnored = P.groups().every(g => !g.muted);
    P.restoreGroups(undefined);
    const undefFallback = P.groups().length === 2 && P.groups().every(g => !g.muted);
    return { partial, unknownIgnored, undefFallback };
  });

  check('a partial block leaves the unnamed group alone', old.partial === 'cloud:m,loop:-', old.partial);
  check('an unknown key is ignored rather than added', old.unknownIgnored === true);
  check('a missing block is not an error', old.undefFallback === true);


  // Hand back a clean pool. The suite leaves short arrays of synthetic slots in
  // S.commitSlots, and rig-audit.js runs the other suites in the SAME app.
  await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const P = await import('./js/pins.js');
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null);
    P.restoreGroups([]);
  });

  // ── O. Undo is the last thing the performer did ──────────────────────────
  // js/history.js (2026-09-05): one action stack. A stroke, a pin placed by
  // hand, an unpin, an erase, an unpin-all are each ONE action; undo takes the
  // last one whatever its kind, redo puts it back, a new action forks history,
  // and holding undo walks back to the top of the show. Through the real
  // paths: the main button paints, plantSeed taps, dropSeqFromCursor drops,
  // releaseCommit unpins, the erase brush erases, clearAllCommits clears.
  console.log('\n§ O. undo — the last user action, of any kind');
  const und = await rig.evaluate(async () => {
    const T = await import('./js/take.js');
    const { S } = await import('./js/state.js');
    const H = await import('./js/history.js');
    const UP = await import('./js/ui-presets.js');
    const US = await import('./js/ui-samples.js');
    const E = await import('./js/erase.js');
    const G = await import('./js/grain.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tick = async (n = 3) => { for (let i = 0; i < n; i++) { G.scheduleGrains(); await sleep(25); } };
    const W = S.canvas.width, Hh = S.canvas.height;
    const keep = { parts: S.particles, slots: S.commitSlots.slice(), hist: S.strokeHistory, mode: S.traceMode, r: S.searchRadiusDeg, muted: S.scanMuted };
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null); S.particles = []; S.strokeHistory = []; H.clear();
    S.traceMode = 'trace'; S.scanMuted = false; S.searchRadiusDeg = 10;
    const wasRelease = S.loopReleaseMode;
    S.mouseInCanvas = true; S.mousePixelX = W * 0.45; S.mousePixelY = Hh * 0.5; await sleep(80);
    const st = () => ({ parts: S.particles.length, slots: S.commitSlots.filter(Boolean).length, kinds: S.commitSlots.filter(Boolean).map(c => c.type).join(','), undo: H.undoCount(), redo: H.redoCount(), stack: H.entries().join('>') });
    const out = {};
    // A painted stroke, the way the looper-anchor check paints one: the audit
    // profile's input is silent and a real gesture deposits nothing behind the
    // noise gate. recordStrokeStart is where the stroke's ACTION is born, so
    // the history sees exactly what a gesture would give it.
    const SP = await import('./js/sphere.js');
    const cur = SP.screenToLonLat(S.mousePixelX, S.mousePixelY);
    const actx = S.audioCtx;
    const paint = () => {
      const buf = T.makeTake(new Float32Array(actx.sampleRate), actx.sampleRate);
      S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
      const idx = S.liveRecBuffers.length - 1;
      US.recordStrokeStart('live', idx);
      const sid = S.currentStrokeId;
      // TAPE marks (`trig`), which is what a line brush deposits. A loop comes
      // from tape and only tape: the drop's fallback search — the one that runs
      // when no armed trigger covers the stroke — skips granular marks, as the
      // `=` key's caller always did before that test moved into the drop
      // (2026-09-14). Untagged marks made this fixture pin a ghost cloud.
      for (let k = 0; k < 8; k++) S.particles.push({ lon: cur.lon + k * 0.6 * Math.PI / 180, lat: cur.lat, strokeId: sid, source: 'live',
        liveBufferIdx: idx, grainStart: 0.1 * k, grainDuration: 0.1, color: '#fff', trig: true, _vo: S.currentVoicing });
      S._particleVersion++;
      S.currentStrokeId = -1;
      return sid;
    };
    paint(); await tick(); out.stroke = st();
    UP.plantSeed(); await tick(); out.pin = st();
    US.undoLastStroke(); await tick(); out.undoPin = st();
    US.redoLastStroke(); await tick(); out.redoPin = st();
    const cloud = S.commitSlots.find(c => c && c.type === 'cloud');
    UP.dropSeqFromCursor(); await tick(); out.drop = st();
    const loop = S.commitSlots.find(c => c && c.type === 'loop');
    out.loopBuilt = !!loop?._sourceNode;
    UP.releaseCommit(); await tick(); out.unpin = st();
    US.undoLastStroke(); await tick(4); out.undoUnpin = st();
    out.sameObjects = !!cloud && !!loop && S.commitSlots.includes(cloud) && S.commitSlots.includes(loop);
    out.dropWhy = loop ? 'ok' : { parts: S.particles.length, nearest: S.particles.slice(0, 2).map(p => ({ src: p.source, sid: p.strokeId, buf: p.liveBufferIdx })), bufs: S.liveRecBuffers.length, sealed: !!S.liveRecBuffers[S.liveRecBuffers.length - 1]?.buffer };
    out.loopRebuilt = !!loop?._sourceNode && !loop._sourceNode._stopped;
    S.searchRadiusDeg = 90; E.startEraseStroke(); await sleep(250); E.stopEraseStroke(); await tick(); out.erase = st();
    US.undoLastStroke(); await tick(); out.undoErase = st();
    S.searchRadiusDeg = 10;
    // A loop leaves by its release: with `fade` its slot nulls on the source's
    // `ended` event ~25 ms on; under load that event can land later than one
    // tick of waiting, so wait for the slots rather than for a fixed time.
    S.loopReleaseMode = 'fade';
    UP.clearAllCommits();
    // Up to 3 s: under the full rig-audit run the `ended` event has landed
    // past the old 1 s and read as "one slot left" (2026-09-12, twice).
    for (let w = 0; w < 120 && S.commitSlots.some(Boolean); w++) { G.scheduleGrains(); await sleep(25); }
    out.unpinAll = st();
    let n = 0; while (H.undoCount() > 0 && n < 20) { US.undoLastStroke(); await sleep(40); n++; }
    await tick(); out.top = { ...st(), n };
    let m = 0; while (H.redoCount() > 0 && m < 20) { US.redoLastStroke(); await sleep(40); m++; }
    await tick(); out.end = { ...st(), m };
    US.undoLastStroke(); await tick();
    UP.plantSeed(); await tick(); out.fork = st();
    // a stroke still recording: undo reaches past it
    const midSid = paint(); S.currentStrokeId = midSid; S.isRecording = true; S.isPainting = true;
    out.midUndoBefore = st();
    US.undoLastStroke(); await sleep(60); out.midUndoAfter = { ...st(), midStillHere: S.particles.some(p => p.strokeId === midSid) };
    S.isRecording = false; S.isPainting = false; S.currentStrokeId = -1;
    UP.clearAllCommits(); S.particles = keep.parts; S.commitSlots = keep.slots; S.strokeHistory = keep.hist; H.clear();
    S.traceMode = keep.mode; S.searchRadiusDeg = keep.r; S.scanMuted = keep.muted; S.mouseInCanvas = false;
    S.loopReleaseMode = wasRelease;
    return out;
  });
  const j = o => JSON.stringify(o);
  check('a stroke is one action', und.stroke.parts > 0 && und.stroke.stack === 'stroke', j(und.stroke));
  check('a tapped cloud is one action on top of it', und.pin.slots === 1 && und.pin.stack === 'stroke>pin', j(und.pin));
  check('undo takes the PIN, not the stroke', und.undoPin.slots === 0 && und.undoPin.parts === und.stroke.parts && und.undoPin.redo === 1, j(und.undoPin));
  check('redo puts the pin back', und.redoPin.slots === 1 && und.redoPin.redo === 0, j(und.redoPin));
  check('a loop dropped by hand is one action, and the scheduler built it', und.drop.stack === 'stroke>pin>pin' && und.loopBuilt === true, j(und.drop) + ' ' + j(und.dropWhy));
  check('unpin is one action', und.unpin.slots === 1 && und.unpin.stack.endsWith('>unpin'), j(und.unpin));
  check('undo of the unpin puts the SAME slot object back', und.undoUnpin.slots === 2 && und.sameObjects === true, j(und.undoUnpin));
  check('… and a restored loop gets its source rebuilt', und.loopRebuilt === true);
  check('an erase is one action, to any depth', und.erase.parts === 0 && und.erase.stack.endsWith('>erase'), j(und.erase));
  check('undo of the erase brings the material back', und.undoErase.parts === und.stroke.parts && und.undoErase.slots === 2, j(und.undoErase));
  check('unpin all is one action', und.unpinAll.slots === 0 && und.unpinAll.stack.endsWith('>unpin'), j(und.unpinAll));
  check('holding undo walks back to the top of the show', und.top.parts === 0 && und.top.slots === 0 && und.top.undo === 0, j(und.top));
  check('holding redo walks forward to where you were', und.end.parts === und.stroke.parts && und.end.redo === 0 && und.end.m === und.top.n, j(und.end));
  check('a new action forks history: redo is gone', und.fork.redo === 0 && und.fork.slots === 3, j(und.fork));
  check('undo while a stroke is still recording reaches past it', und.midUndoAfter.undo === und.midUndoBefore.undo - 1 && und.midUndoAfter.stack.endsWith('>stroke') && und.midUndoAfter.midStillHere === true, j(und.midUndoAfter));

  // ── P. The pin's dead band ────────────────────────────────────────────────
  // pinDown decides the KIND with a coarse test (nearest particle within 1.5×
  // the radius → a tape stroke → drop a loop) and dropSeqFromCursor accepts
  // only the radius itself. Between the two, the drop declined and the press
  // did NOTHING — no loop, no ghost — measured in the browser on 2026-09-12 as
  // a band ~100–130 px out from a take. The ruling is Ek's (2026-08-28):
  // nothing in reach is NOT a no-op, the press still pins a cloud. So a press
  // inside the radius is a loop, and a press anywhere else is a cloud.
  console.log('\n§ P. the pin\'s dead band — a press the drop declines still plants a ghost');
  const db = await rig.evaluate(async () => {
    const T = await import('./js/take.js');
    const { S } = await import('./js/state.js');
    const H = await import('./js/history.js');
    const UP = await import('./js/ui-presets.js');
    const US = await import('./js/ui-samples.js');
    const G = await import('./js/grain.js');
    const SP = await import('./js/sphere.js');
    const R = await import('./js/renderer.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tick = async (n = 3) => { for (let i = 0; i < n; i++) { G.scheduleGrains(); await sleep(25); } };
    const W = S.canvas.width, Hh = S.canvas.height;
    const keep = { parts: S.particles, slots: S.commitSlots.slice(), hist: S.strokeHistory, mode: S.traceMode, r: S.searchRadiusDeg, muted: S.scanMuted, nearest: S.nearestMode };
    S.commitSlots = new Array(S.commitSlotCount ?? 16).fill(null); S.particles = []; S.strokeHistory = []; H.clear();
    S.traceMode = 'trace'; S.scanMuted = false; S.searchRadiusDeg = 10; S.nearestMode = false;
    const baseX = W * 0.5, baseY = Hh * 0.5;
    S.mouseInCanvas = true; S.mousePixelX = baseX; S.mousePixelY = baseY; R.drawFrame(); await sleep(20);
    const cur = SP.screenToLonLat(baseX, baseY);
    const actx = S.audioCtx;
    const buf = T.makeTake(new Float32Array(actx.sampleRate), actx.sampleRate);
    S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
    const idx = S.liveRecBuffers.length - 1;
    US.recordStrokeStart('live', idx);
    const sid = S.currentStrokeId;
    // A TAPE take: `trig` is what makes pinDown reach for the drop.
    for (let k = 0; k < 4; k++) S.particles.push({ lon: cur.lon + k * 0.3 * Math.PI / 180, lat: cur.lat, strokeId: sid, source: 'live', trig: true,
      liveBufferIdx: idx, grainStart: 0.1 * k, grainDuration: 0.1, color: '#fff', _vo: S.currentVoicing });
    S._particleVersion++; S.currentStrokeId = -1;
    const rad = S.searchRadiusDeg * Math.PI / 180;
    const angAt = () => Math.min(...S.particles.map(p => G.angleBetweenSphere(p.lon, p.lat, S._frameCursorLon ?? 0, S._frameCursorLat ?? 0)));
    // Walk the cursor out from the take until the angle sits in each zone.
    const zones = { inside: a => a < rad * 0.8, band: a => a > rad * 1.05 && a < rad * 1.45, beyond: a => a > rad * 1.7 };
    const out = {};
    for (const [name, inZone] of Object.entries(zones)) {
      let placed = null;
      for (let px = 0; px < W * 0.45; px += 4) {
        // drawFrame() is what turns mousePixelX into _frameCursorLon, and it
        // runs on rAF — which Chromium throttles hard when the window is not
        // the frontmost one. Sleeping 40 ms and hoping a frame landed made
        // the whole section report `placed: null` (no zone ever found) on a
        // machine running several rig instances, 2026-09-13. Ask for the
        // frame instead of waiting for it.
        S.mousePixelX = baseX - px; R.drawFrame(); await sleep(4);
        const a = angAt(); if (inZone(a)) { placed = { px, deg: +(a * 180 / Math.PI).toFixed(1) }; break; }
      }
      if (!placed) { out[name] = { placed: null }; continue; }
      await S._pinTap(); await tick();
      out[name] = { ...placed, kinds: S.commitSlots.filter(Boolean).map(c => c.type).join(',') || 'NOTHING' };
      UP.clearAllCommits(); for (let w = 0; w < 40 && S.commitSlots.some(Boolean); w++) { G.scheduleGrains(); await sleep(25); }
    }
    out.radiusDeg = S.searchRadiusDeg;
    UP.clearAllCommits(); S.particles = keep.parts; S.commitSlots = keep.slots; S.strokeHistory = keep.hist; H.clear();
    S.traceMode = keep.mode; S.searchRadiusDeg = keep.r; S.scanMuted = keep.muted; S.nearestMode = keep.nearest; S.mouseInCanvas = false;
    return out;
  });
  check('inside the radius the press drops the take as a loop', db.inside?.kinds === 'loop', JSON.stringify(db.inside));
  check('between the radius and 1.5× it the press plants a ghost cloud — never nothing', db.band?.kinds === 'cloud', JSON.stringify(db.band));
  check('beyond 1.5× the radius the press plants a ghost cloud', db.beyond?.kinds === 'cloud', JSON.stringify(db.beyond));

  // ── H. Frozen brushes ─────────────────────────────────────────────────────
  // docs/archive/BRUSH-MODEL.md step 3. A stroke freezes the brush that painted it, so
  // going back over old material plays it with the settings it was painted
  // with rather than whatever brush is selected now.
  console.log('\n§ H. frozen brushes — material remembers what painted it');
  const froz = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const BV = await import('./js/brush-voicing.js');
    const US = await import('./js/ui-samples.js');
    const X  = await import('./js/piece.js');
    S.voicings = []; S.voicingSeq = 0; S.particles.length = 0;

    // A voicing is keyed on the TILE in the hand (2026-09-03), so two tiles
    // are two brushes even on the same live block. The hand is stood in for
    // directly: tiles.js publishes it, and this section is about the record
    // path, not the rail.
    const hand = { id: 'A', label: 'A', wet: false };
    const savedHand = S._handTile;
    S._handTile = () => hand;
    US.recordStrokeStart('live', 0);
    const voA = S.currentVoicing;
    US.recordStrokeStart('live', 0);        // same brush, untouched
    const voA2 = S.currentVoicing;
    hand.id = 'B'; hand.label = 'B';
    US.recordStrokeStart('live', 0);
    const voB = S.currentVoicing;
    hand.id = 'A'; hand.label = 'A';
    US.recordStrokeStart('live', 0);        // back again — must reuse
    const voA3 = S.currentVoicing;
    S._handTile = savedHand;
    const tileA = BV.voicingById(voA)?.tile, tileB = BV.voicingById(voB)?.tile;

    const pA = BV.voicingById(voA)?.params, pB = BV.voicingById(voB)?.params;

    // Two marks, one per brush, then a round trip.
    S.particles.push({ lon: 0, lat: 0, strokeId: 1, _vo: voA, source: 'live',
                       liveBufferIdx: 0, grainStart: 0, grainDuration: 0.1, color: '#fff' });
    S.particles.push({ lon: 0.1, lat: 0, strokeId: 2, _vo: voB, source: 'live',
                       liveBufferIdx: 0, grainStart: 0, grainDuration: 0.1, color: '#fff' });

    const built   = X.__testBuildPiece();
    const payload = JSON.parse(JSON.stringify(built.manifest));
    const wire = payload.live?.voicings;
    const wireVo = payload.particles.map(p => p.vo);

    S.voicings = []; S.voicingSeq = 0; S.particles.length = 0;
    await X.__testApplyPiece(payload, built.audio);
    const back = S.particles.map(p => p._vo);
    const pABack = BV.voicingById(back[0])?.params;

    S.particles.length = 0;
    return {
      voA, voA2, voB, voA3, tableSize: wire?.list?.length,
      dedup: voA === voA2 && voA === voA3, distinct: voA !== voB,
      tileA, tileB,
      sameBlock: JSON.stringify(pA) === JSON.stringify(pB),
      wireVo, back,
      paramsSurvived: JSON.stringify(pABack) === JSON.stringify(pA),
    };
  });

  check('two brushes give two voicings', froz.distinct === true, `A=${froz.voA} B=${froz.voB}`);
  check('...keyed on the tile, even on one live block', froz.sameBlock === true && froz.tileA === 'A' && froz.tileB === 'B',
    `tiles ${froz.tileA}/${froz.tileB}, same block ${froz.sameBlock}`);
  check('repainting with an untouched brush reuses its voicing', froz.dedup === true,
    `${froz.voA}/${froz.voA2}/${froz.voA3} — four strokes must not make four voicings`);
  check('the table holds only the distinct ones', froz.tableSize === 2, String(froz.tableSize));
  check('each mark carries its voicing on the wire', JSON.stringify(froz.wireVo) === JSON.stringify([froz.voA, froz.voB]),
    JSON.stringify(froz.wireVo));
  check('marks come back pointing at the same voicings', JSON.stringify(froz.back) === JSON.stringify([froz.voA, froz.voB]),
    JSON.stringify(froz.back));
  check('and the params behind them survived intact', froz.paramsSurvived === true);

  // ── I. k is the LENS's (#233, reversing #212's k half) ───────────────────
  // Flow made density a painted, visible property of the material, so how
  // many marks the cursor READS at once — k, fill, order — is the lens's,
  // live and global. One k caps the whole pool whatever brush painted it;
  // fill:'all' lifts the cap; voicings freeze only the SOUND and carry no k;
  // and k/fill/order left the patch vocabulary, so applying a patch cannot
  // move the lens. Aperture is deleted — with k on the lens it had no job.
  console.log('\n§ I. k, fill and order belong to the lens');
  const kper = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G  = await import('./js/grain.js');
    const US = await import('./js/ui-samples.js');
    const BV = await import('./js/brush-voicing.js');
    const PT = await import('./js/param-registry.js');
    S.voicings = []; S.voicingSeq = 0; S.particles.length = 0;
    S.nearestMode = false; S.searchRadiusDeg = 90; S.recencyN = 0;
    const prevAll = S.grainKAllMode; S.grainKAllMode = false;

    // Two brushes = two TILES in the hand (see § H); the bank is gone.
    const hand = { id: 'A', label: 'A', wet: false };
    const savedHand = S._handTile; S._handTile = () => hand;
    const paint = (brush, n, lat) => {
      hand.id = brush; hand.label = brush;
      US.recordStrokeStart('live', 0);
      const vo = S.currentVoicing;
      for (let i = 0; i < n; i++) {
        const p = { lon: 0.001 * i, lat, strokeId: S.currentStrokeId, _vo: vo,
                    source: 'live', liveBufferIdx: 0, grainStart: 0, grainDuration: 0.1, color: '#fff' };
        G.stampCartesian(p); S.particles.push(p);
      }
      return vo;
    };
    const voWide  = paint('A', 40, 0);
    const voTight = paint('B', 40, 0.01);
    S._particleVersion = (S._particleVersion || 0) + 1;

    const noK = !('k' in (BV.voicingById(voWide)?.params ?? {}))
             && !('kAllMode' in (BV.voicingById(voWide)?.params ?? {}))
             && !('kSeqMode' in (BV.voicingById(voWide)?.params ?? {}));

    const total = (k, nearest) => G.__testCandidatePool(0, 0.005, { nearest, k }).length;
    const t8  = total(8, false);
    const t3  = total(3, false);
    const tn3 = total(3, true);
    S.grainKAllMode = true;
    const tAll = total(3, false);
    S.grainKAllMode = false;

    const regClean = !PT.PARAM_REGISTRY.some(r =>
      r.key === 'k' || r.key === 'grainKAllMode' || r.key === 'grainKSeqMode');

    S.grainKAllMode = prevAll; S._handTile = savedHand;
    S.particles.length = 0; S.voicings = []; S.voicingSeq = 0;
    return { noK, t8, t3, tn3, tAll, regClean };
  });

  check('voicings freeze the sound and carry no k / fill / order', kper.noK === true);
  check('one lens k caps the whole pool across voicings', kper.t8 === 8 && kper.t3 === 3,
    `k=8 → ${kper.t8}, k=3 → ${kper.t3}`);
  check('nearest mode uses the same lens k', kper.tn3 === 3, String(kper.tn3));
  check("fill 'all' lifts the cap entirely", kper.tAll === 80, String(kper.tAll));
  check('k, fill and order have left the patch vocabulary', kper.regClean === true);

  // ── J. A pinned cloud owns its material ───────────────────────────────────
  // Ek, 2026-08-30: "when I pin a cloud I shouldn't hear double — that exact
  // cloud, or the particles, are unavailable for cursor-granulation until I
  // unpin them." Driven through __testCandidatePool, which mirrors the
  // scheduler's own geometry-then-cap order, so this asserts the path the
  // cursor actually takes rather than a copy of it.
  console.log('\n§ J. a pinned cloud owns its material');
  const owns = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const keepParts = S.particles.slice();
    const keepSlots = S.commitSlots.slice();
    const keepNear = S.nearestMode, keepRec = S.recencyN;
    const keepRad = S.searchRadiusDeg, keepAll = S.grainKAllMode;
    S.commitSlots = new Array(keepSlots.length).fill(null);
    S.particles.length = 0;
    S.nearestMode = false; S.recencyN = 0; S.searchRadiusDeg = 20;
    S.grainKAllMode = true;          // fill:'all' — no k cap, so counts are exact

    // Two clusters ~68° apart: A under the cursor, B out of reach.
    const mk = (lon, lat) => { const p = { lon, lat, strokeId: 1, grainStart: 0,
      grainDuration: 0.1, bufferKey: 'live' }; G.stampCartesian(p); S.particles.push(p); };
    for (let i = 0; i < 10; i++) mk(0.02 * i, 0);
    for (let i = 0; i < 10; i++) mk(1.2 + 0.02 * i, 0);
    S._particleVersion = (S._particleVersion || 0) + 1;
    const rad  = (lon) => G.__testCandidatePool(lon, 0, { nearest: false, k: 64 }).length;
    const near = (lon) => G.__testCandidatePool(lon, 0, { nearest: true,  k: 64 }).length;

    const beforeRad = rad(0.1), beforeNear = near(0.1);

    S.commitSlots[0] = { type: 'cloud', slotIndex: 0, playing: true, lon: 0.1, lat: 0,
                         searchRadiusDeg: 20, color: '#e8a030', grainParams: {}, grainOverrides: {} };
    const claims = G.__testCloudClaims();
    const pinnedRad = rad(0.1), pinnedNear = near(0.1), otherRad = rad(1.3);
    // THE OTHER SIDE, and the one that actually broke. The cloud reads through
    // _buildCandidatePoolRadius too, on its own particles, so applying the claim
    // inside that builder unconditionally makes a pinned cloud skip exactly the
    // material it exists to play. It shipped that way for one revision and the
    // symptom was "when I pin the cloud it's not playing" — invisible to a test
    // that only reads the cursor's pool.
    const seedPool = (G.__testSeedPool(0) || []).length;

    // Silencing it does not hand the material back — the claim is by PINNING.
    S.commitSlots[0].playing = false;
    const mutedRad = rad(0.1);
    S.commitSlots[0].playing = true;

    // A pinned LOOP needs none of this: its stroke is trigger material, which
    // every builder already skips. Asserted so the two halves cannot drift.
    S.particles.forEach(p => { p.trig = true; });
    S.commitSlots[0] = null;
    const trigRad = rad(0.1);
    S.particles.forEach(p => { delete p.trig; });

    const afterRad = rad(0.1), afterNear = near(0.1);

    S.particles.length = 0;
    for (const p of keepParts) S.particles.push(p);
    S.commitSlots = keepSlots;
    S.nearestMode = keepNear; S.recencyN = keepRec;
    S.searchRadiusDeg = keepRad; S.grainKAllMode = keepAll;
    S._particleVersion = (S._particleVersion || 0) + 1;
    return { beforeRad, beforeNear, claims, pinnedRad, pinnedNear, otherRad, seedPool,
             mutedRad, trigRad, afterRad, afterNear };
  });

  check('the cursor reads the paint before anything is pinned',
    owns.beforeRad === 10 && owns.beforeNear === 20,
    `radius=${owns.beforeRad} nearest=${owns.beforeNear}`);
  check('a pinned cloud claims what is in its radius',
    owns.claims.n === 1 && owns.claims.claimed === 10, JSON.stringify(owns.claims));
  check('the cursor no longer granulates the claimed material — no doubling',
    owns.pinnedRad === 0, `${owns.pinnedRad} candidate(s) still offered`);
  check('nearest mode drops them too, and it has its own pass',
    owns.pinnedNear === 10, `${owns.pinnedNear} — nearest hands the whole sphere to _selectPerVoicing`);
  check('the cloud still granulates what it claims — it is the thing playing it',
    owns.seedPool === 10,
    `${owns.seedPool} candidate(s) — 0 means the claim leaked into the seed path and the pin is silent`);
  check('material outside the cloud is untouched', owns.otherRad === 10, String(owns.otherRad));
  check('silencing the cloud does not hand its material back to the cursor',
    owns.mutedRad === 0, `${owns.mutedRad} — the claim is by pinning, not by sounding`);
  check('a loop\'s stroke was already excluded, as trigger material',
    owns.trigRad === 0, String(owns.trigRad));
  check('unpinning gives the material back',
    owns.afterRad === 10 && owns.afterNear === 20,
    `radius=${owns.afterRad} nearest=${owns.afterNear}`);

  // ── J2. A cloud is a moving cursor — it reads a mark with the MARK's voicing
  // Ek, 2026-09-05: "the pin is just a moving cursor — if I change the material
  // under it, it should change." Before this a cloud played everything under it
  // with the block it was pinned with, so a wet brush's knobs never reached the
  // wash cloud's material. Tested at the seed POST: the bridge's bucketing is
  // the whole change, and what the worklet receives is what it plays.
  console.log('\n§ J2. a cloud reads a mark with the mark\'s voicing — a wet brush reaches its wash');
  const cv = await rig.evaluate(async () => {
    const T = await import('./js/take.js');
    const { S } = await import('./js/state.js');
    const BV = await import('./js/brush-voicing.js');
    const US = await import('./js/ui-samples.js');
    const WB = await import('./js/grain-worklet-bridge.js');
    const A  = await import('./js/audio.js');
    const actx = A.ensureAudioContext();
    // A buffer the worklet knows. The rig has not recorded yet, so the engine
    // is cold-started on it the way a sample paint does (main.js).
    const buf = T.makeTake(new Float32Array(actx.sampleRate), actx.sampleRate);
    if (!S._postWorkletSeeds) await S._ensureWorkletForSample?.(buf);
    else WB.hotSwapRecording(buf);
    if (!S._postWorkletSeeds) return { noWorklet: true };
    const savedHand = S._handTile, savedIsWet = S._tileIsWet, savedPitch = S.grainOverrides.pitchShift;
    const keepParts = S.particles.slice(), keepLive = S.liveRecBuffers.slice();
    const keepVo = S.voicings, keepSeq = S.voicingSeq;
    const hand = { id: 'W', label: 'W', wet: true };
    S._handTile = () => hand;
    S._tileIsWet = id => id === 'W' && hand.wet;
    S.voicings = []; S.voicingSeq = 0; S.particles.length = 0;

    // One wet brush, one dry brush, and a buffer the worklet knows.
    S.grainOverrides.pitchShift = 100;
    US.recordStrokeStart('live', 0); const w = S.currentVoicing;
    hand.id = 'D'; hand.wet = false;
    S.grainOverrides.pitchShift = 200;
    US.recordStrokeStart('live', 0); const d = S.currentVoicing;
    hand.id = 'W'; hand.wet = true;
    S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
    const idx = S.liveRecBuffers.length - 1;
    const mk = (n, vo, sid) => { const out = []; for (let i = 0; i < n; i++) out.push({ lon: 0.01 * i, lat: 0, strokeId: sid, source: 'live',
      liveBufferIdx: idx, grainStart: 0.1 + 0.05 * i, grainDuration: 0.1, color: '#fff', _vo: vo }); return out; };
    const pool = [...mk(5, w, 1), ...mk(4, d, 2), ...mk(3, 0, 3)];
    const own = { pitchShift: 300, period: 0.03, duration: 0.2 };
    const seed = (slot, extra) => ({ slotIndex: slot, pool, gain: 1, grainParams: own, overrides: null, kSeqMode: false, ...extra });
    const post = (seeds) => { S._postWorkletSeeds(seeds); return WB.getWorkletDiag().seeds.map(v => ({ index: v.index, slot: v.slot, vo: v.vo, n: v.candidates.length, pitch: v.params.pitchShift })); };
    const byVo = (list, slot, vo) => list.find(v => v.slot === slot && v.vo === vo);

    S.grainOverrides.pitchShift = 100;       // the wet brush's knob, back in the hand
    const one = post([seed(0)]);
    // The wet knob moves: only the wet voice follows.
    S.grainOverrides.pitchShift = 700;
    const two = post([seed(0)]);
    // A second cloud over the same material has voices of its own.
    const three = post([seed(0), seed(1)]);
    // The morph lands on top of whichever block plays.
    const four = post([seed(0, { overrides: { pitchShift: 900 } })]);
    // Voices come back when a cloud goes.
    const none = post([]);
    const again = post([seed(1)]);

    S._handTile = savedHand; S._tileIsWet = savedIsWet; S.grainOverrides.pitchShift = savedPitch ?? null;
    S.particles.length = 0; for (const p of keepParts) S.particles.push(p);
    S.liveRecBuffers = keepLive; S.voicings = keepVo; S.voicingSeq = keepSeq;
    post([]);
    return { w, d, one, two, three, four, none, again,
             oneW: byVo(one, 0, w), oneD: byVo(one, 0, d), oneO: byVo(one, 0, 0),
             twoW: byVo(two, 0, w), twoD: byVo(two, 0, d), twoO: byVo(two, 0, 0),
             threeW0: byVo(three, 0, w), threeW1: byVo(three, 1, w),
             fourW: byVo(four, 0, w), fourO: byVo(four, 0, 0) };
  });
  if (cv.noWorklet) {
    check('the worklet is running (S._postWorkletSeeds)', false, 'no seed post to test against');
  } else {
    check('one cloud posts one voice per voicing under it',
      cv.one.length === 3 && cv.oneW?.n === 5 && cv.oneD?.n === 4 && cv.oneO?.n === 3,
      JSON.stringify(cv.one));
    check('a voiced mark plays with ITS voicing, an unvoiced one with the cloud\'s own block',
      cv.oneW?.pitch === 100 && cv.oneD?.pitch === 200 && cv.oneO?.pitch === 300,
      `wet ${cv.oneW?.pitch} dry ${cv.oneD?.pitch} own ${cv.oneO?.pitch}`);
    check('the wet brush\'s knob reaches the cloud\'s material, and only its own strokes',
      cv.twoW?.pitch === 700 && cv.twoD?.pitch === 200 && cv.twoO?.pitch === 300,
      `wet ${cv.twoW?.pitch} dry ${cv.twoD?.pitch} own ${cv.twoO?.pitch}`);
    check('a voice keeps its worklet index between ticks — its onset clock runs on',
      cv.oneW && cv.twoW && cv.oneW.index === cv.twoW.index && cv.oneD.index === cv.twoD.index && cv.oneO.index === cv.twoO.index,
      `${JSON.stringify(cv.one)} → ${JSON.stringify(cv.two)}`);
    check('two clouds over the same material have voices of their own',
      cv.three.length === 6 && cv.threeW0 && cv.threeW1 && cv.threeW0.index !== cv.threeW1.index
        && new Set(cv.three.map(v => v.index)).size === 6,
      JSON.stringify(cv.three));
    check('the cloud\'s morph lands on top of whichever block plays',
      cv.fourW?.pitch === 900 && cv.fourO?.pitch === 900, `wet ${cv.fourW?.pitch} own ${cv.fourO?.pitch}`);
    check('an empty post clears every voice, and a cloud that returns gets voices again',
      cv.none.length === 0 && cv.again.length === 3, `${cv.none.length} then ${cv.again.length}`);
  }

  // ── K. The reach line is not drawn to a pinned cloud's material ───────────
  // Ek, on the rig: "visually the cursor will still draw a line to the
  // particles that are claimed by a pinned cloud when they are in radius, it
  // shouldn't." Counted at the CANVAS, by recording the moveTo/lineTo pairs a
  // real drawFrame() issues — not by testing the predicate, which is the part
  // that was already right. The renderer forgetting to call it is the failure
  // this has to catch.
  console.log('\n§ K. no reach line to a pinned cloud\'s material');
  const lines = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const R = await import('./js/renderer.js');
    const keepParts = S.particles.slice();
    const keepSlots = S.commitSlots.slice();
    const keepNear = S.nearestMode, keepRad = S.searchRadiusDeg;
    S.commitSlots = new Array(keepSlots.length).fill(null);
    S.particles.length = 0;
    S.nearestMode = false; S.searchRadiusDeg = 20;

    // Material at the cursor's own position, so every particle is in reach.
    const cLon = S._frameCursorLon ?? 0, cLat = S._frameCursorLat ?? 0;
    for (let i = 0; i < 8; i++) {
      const p = { lon: cLon + 0.01 * i, lat: cLat, strokeId: 1, grainStart: 0,
                  grainDuration: 0.1, bufferKey: 'live', color: '#e8a030' };
      G.stampCartesian(p);
      S.particles.push(p);
    }
    S._particleVersion = (S._particleVersion || 0) + 1;

    // Tag them all as SOUNDING, the way the worklet's feedback does — white for
    // every firing grain, whatever fired it. That ambiguity is the bug's cause.
    // A line is drawn per CANDIDATE — the scheduler's published pool — and a
    // ring per grain in flight (renderer.js, 2026-09-02). Publish the pool the
    // way grain.js does, and tag every particle as sounding as well so the
    // two marks can be told apart: the ring count is not what is asserted.
    const tag = (poolN = S.particles.length) => {
      G.activeGrainMap.clear();
      const exp = performance.now() + 5000;
      for (const p of S.particles) G.activeGrainMap.set(p, { expiry: exp, glowColor: '#ffffff' });
      S._cursorPool   = S.particles.slice(0, poolN);
      S._cursorPoolAt = performance.now();
    };

    // Count the line segments one real frame draws from the reticle.
    const ctx = S.ctx;
    // The MIN of three frames: one line somewhere in the frame comes and
    // goes on its own clock (784 vs 785 across a full rig-audit run, three
    // times on 2026-09-12), and every assertion below is an exact difference.
    // Counted in the FAN'S OWN INK, not every line on the frame. The fan is one
    // path stroked in '#ffffff' (renderer.js), and
    // filtering on that is what keeps this measuring reach and nothing else.
    // It had to: the selected pin's focus bracket draws EIGHT segments, and the
    // frame this section calls `pinned` has a selected pin while `baseline` has
    // none — so the bracket's +8 cancelled the fan's −8 exactly and the check
    // read 775 → 775 against an expected drop of 8 (2026-09-13).
    // The SELECTED PIN'S FOCUS BRACKET is excluded, by its ink and its line
    // width together — the pair is the bracket and nothing else on the frame.
    // It draws EIGHT segments, and the frame this section calls `pinned` has a
    // selected pin while `baseline` has none, so its +8 cancelled the fan's −8
    // exactly and the check read 775 → 775 against an expected drop of 8
    // (2026-09-13). Everything else on the frame is still counted, which is
    // what keeps the three exact differences below meaningful.
    const bone = (getComputedStyle(document.body).getPropertyValue('--eng-pins').trim() || '#cfc7bc').toLowerCase();
    const isBracket = () => {
      const sc = String(ctx.strokeStyle).toLowerCase();
      return (sc === bone || sc === 'rgb(207, 199, 188)') && Math.abs(ctx.lineWidth - 1.6) < 0.01;
    };
    const countOnce = () => {
      const realMove = ctx.moveTo.bind(ctx), realLine = ctx.lineTo.bind(ctx);
      let n = 0;
      ctx.moveTo = (...a) => realMove(...a);
      ctx.lineTo = (...a) => { if (!isBracket()) n++; return realLine(...a); };
      try { R.drawFrame(); } finally { ctx.moveTo = realMove; ctx.lineTo = realLine; }
      return n;
    };
    // THE GAZE TRAIL IS NOT PART OF THE MEASUREMENT. It is a polyline of the
    // cursor's last `gazeTrailSec` seconds, appended per frame and shifted by
    // AGE (renderer.js drawFrame / drawGazeTrail) — so between two counts a
    // point can arrive or expire and the total moves by one lineTo. Every
    // check here asserts an exact difference (a drop of 8, a drop of 5, an
    // equality), so one stray segment fails three of them, and only sometimes:
    // on 2026-09-13 a full-suite run read 786 → 777 for a drop of 8 while the
    // same section alone was green. `Math.min` of three runs was an attempt to
    // sit under the noise; zeroing the trail removes it (gazeTrailSec = 0 both
    // skips the draw and empties the buffer), and the fan being measured is
    // untouched by it.
    const keepTrailSec = S.gazeTrailSec;
    S.gazeTrailSec = 0;
    R.drawFrame();                       // one frame to flush the buffer
    const countLines = () => Math.min(countOnce(), countOnce(), countOnce());

    tag(); const baseline = countLines();
    // The fan is the SELECTION and stands on its own: an empty glow map — the
    // frame or two between one grain expiring and the next onset, which on a
    // 500 ms period is most frames — must not take the reach lines with it.
    // The fan lived inside `if (_glowCache.size > 0)` until 2026-09-07 and
    // every check here tagged the particles as sounding first, which is
    // exactly why nobody saw it blink.
    G.activeGrainMap.clear();
    S._cursorPool = S.particles.slice(); S._cursorPoolAt = performance.now();
    const silent = countLines();
    // k = 3 with all eight grains still sounding: three lines, not eight.
    tag(3); const kThree = countLines();
    S._cursorPoolAt = 0; const stale = countLines();   // a dead scheduler draws no reach
    S.commitSlots[0] = { type: 'cloud', slotIndex: 0, playing: true, lon: cLon, lat: cLat,
                         searchRadiusDeg: 20, color: '#e8a030', grainParams: {}, grainOverrides: {},
                         _plantedAt: performance.now() / 1000, _envGainCurrent: 1 };
    tag(); const pinned = countLines();
    S.commitSlots[0] = null;
    tag(); const unpinned = countLines();

    S.gazeTrailSec = keepTrailSec;
    G.activeGrainMap.clear();
    S.particles.length = 0;
    for (const p of keepParts) S.particles.push(p);
    S.commitSlots = keepSlots;
    S.nearestMode = keepNear; S.searchRadiusDeg = keepRad;
    S._particleVersion = (S._particleVersion || 0) + 1;
    S._cursorPool = null; S._cursorPoolAt = 0;
    return { baseline, silent, kThree, stale, pinned, unpinned };
  });

  // The frame draws other lines too (grid, chrome), so the assertion is the
  // DIFFERENCE: pinning must remove exactly the fan, and unpinning restore it.
  check('one line per candidate: k = 3 draws three lines while eight grains sound',
    lines.baseline - lines.kThree === 5, `${lines.baseline} → ${lines.kThree}, expected a drop of 5`);
  check('the fan is the selection, not the sound: no grain sounding still draws it',
    lines.silent === lines.baseline,
    `${lines.silent} vs ${lines.baseline} — the reach fan is gated on the glow map again`);
  check('a stale pool draws no reach',
    lines.baseline - lines.stale === 8, `${lines.baseline} → ${lines.stale}, expected a drop of 8`);
  check('pinning removes the reach lines to the claimed material',
    lines.baseline > lines.pinned,
    `${lines.baseline} line segment(s) before, ${lines.pinned} after — no drop means the fan is still drawn`);
  check('exactly the eight claimed particles lose their line',
    lines.pinned + 8 === lines.baseline,
    `${lines.baseline} → ${lines.pinned}, expected a drop of 8`);
  check('unpinning draws them again',
    lines.unpinned === lines.baseline,
    `${lines.unpinned} vs ${lines.baseline}`);

  // ── K2. One glow mark (2026-09-07) ───────────────────────────────────────
  // Nothing about a sounding mark varies but WHETHER it is lit and for how
  // long. Three weightings were deleted to get here — a core-and-ring face
  // past a duration threshold, the same threshold moved onto the onset rate,
  // and a continuous ramp replacing it — each found by Ek the same way, as an
  // event that looked different in different conditions. So the assertion is
  // sameness: two frames drawn over the identical marks, one played slowly and
  // once each, the other short and hammered, must issue the SAME arcs at the
  // SAME alpha. A ring is an extra arc, a weighting is a different radius or a
  // second alpha; all of them fail here.
  console.log('\n§ K2. one glow mark — the same arcs at the same alpha, at any rate');
  const faces = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const R = await import('./js/renderer.js');
    const keepParts = S.particles.slice();
    const cLon = S._frameCursorLon ?? 0, cLat = S._frameCursorLat ?? 0;
    S.particles.length = 0;
    for (let i = 0; i < 8; i++) {
      const p = { lon: cLon + 0.01 * i, lat: cLat, strokeId: 1, grainStart: 0,
                  grainDuration: 0.1, bufferKey: 'live', color: '#e8a030' };
      G.stampCartesian(p);
      S.particles.push(p);
    }
    S._particleVersion = (S._particleVersion || 0) + 1;

    // Every arc a real frame issues, with the alpha standing when it was
    // issued — radius and alpha are exactly what a returning weighting moves.
    const ctx = S.ctx;
    const shot = () => {
      const realArc = ctx.arc.bind(ctx);
      const out = [];
      ctx.arc = (x, y, r, ...a) => { out.push(`${r.toFixed(3)}@${ctx.globalAlpha.toFixed(3)}`); return realArc(x, y, r, ...a); };
      try { R.drawFrame(); } finally { ctx.arc = realArc; }
      return out.sort();
    };
    const minus = (a, b) => { const l = b.slice(); return a.filter(v => { const i = l.indexOf(v); if (i < 0) return true; l.splice(i, 1); return false; }); };

    G.activeGrainMap.clear();
    S._cursorPool = null; S._cursorPoolAt = 0;
    const quiet = shot();
    const lit = (durMs, hits) => {
      G.activeGrainMap.clear();
      const now = performance.now();
      for (let h = 0; h < hits; h++) for (const p of S.particles) G.markGlow(p, durMs, '#ffffff', now + h);
      return minus(shot(), quiet);
    };
    const slow = lit(500, 1);     // one grain each, long, the lone case
    const fast = lit(5, 12);      // hammered and short, the crowd
    const life = (() => {
      G.activeGrainMap.clear();
      const p = S.particles[0], t0 = performance.now();
      G.markGlow(p, 5, '#ffffff', t0);
      const short = G.activeGrainMap.get(p).expiry - t0;
      G.markGlow(p, 500, '#ffffff', t0);
      return { short, long: G.activeGrainMap.get(p).expiry - t0 };
    })();

    G.activeGrainMap.clear();
    S.particles.length = 0;
    for (const p of keepParts) S.particles.push(p);
    S._particleVersion = (S._particleVersion || 0) + 1;
    return { slow, fast, life, floor: G.GLOW_MIN_MS };
  });
  check('eight sounding marks add eight arcs, not sixteen',
    faces.slow.length === 8,
    `${faces.slow.length} arc(s) added by eight marks — a ring is back`);
  check('a hammered fast patch draws exactly the same arcs at the same alpha',
    JSON.stringify(faces.slow) === JSON.stringify(faces.fast),
    `slow ${faces.slow.join(' ')} vs fast ${faces.fast.join(' ')}`);
  check('every mark is drawn at one alpha',
    new Set(faces.slow.map(v => v.split('@')[1])).size === 1,
    `alphas: ${[...new Set(faces.slow.map(v => v.split('@')[1]))].join(', ')}`);
  check(`the length still sets how long a mark stays lit, floored at ${faces.floor} ms`,
    faces.life.short === faces.floor && Math.round(faces.life.long) === 500,
    `5 ms → ${faces.life.short} ms, 500 ms → ${faces.life.long} ms`);

  // ── L. Wet paint (Ek, 2026-09-03) ────────────────────────────────────────
  // A brush toggled wet owns ONE voicing; every stroke it paints points at it;
  // its knobs move that voicing in place, so every stroke it painted follows;
  // a dry brush's strokes never move; off dries where it sounds; and the
  // session file carries `wet`, honoured only on a rig where the tile is
  // still wet. The knob is moved by writing the live override and calling the
  // sync the bridge runs per tick — the record path, not the rail.
  console.log('\n§ L. wet paint — a wet brush\'s knobs move every stroke it painted');
  const wet = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const BV = await import('./js/brush-voicing.js');
    const US = await import('./js/ui-samples.js');
    const X  = await import('./js/piece.js');
    const savedHand = S._handTile, savedIsWet = S._tileIsWet, savedPitch = S.grainOverrides.pitchShift;
    const hand = { id: 'W', label: 'W', wet: true };
    S._handTile = () => hand;
    S._tileIsWet = id => id === 'W' && hand.wet;
    const pitchOf = vo => BV.voicingById(vo)?.params.pitchShift;
    const reset = () => { S.voicings = []; S.voicingSeq = 0; S.particles.length = 0; };
    reset();
    S.grainOverrides.pitchShift = 0;

    US.recordStrokeStart('live', 0); const w1 = S.currentVoicing;
    US.recordStrokeStart('live', 0); const w2 = S.currentVoicing;     // one voicing per wet brush
    const wetFlag = BV.voicingById(w1)?.wet === true;
    const p0 = pitchOf(w1);
    S.grainOverrides.pitchShift = 700;
    const synced = BV.syncWetVoicing();
    const p1 = pitchOf(w1);

    // A DRY brush painted beside it: the knob must not reach its strokes.
    hand.id = 'D'; hand.wet = false;
    US.recordStrokeStart('live', 0); const d1 = S.currentVoicing;
    const dp0 = pitchOf(d1);
    S.grainOverrides.pitchShift = 800;
    const syncedDry = BV.syncWetVoicing();
    const dp1 = pitchOf(d1), p1b = pitchOf(w1);
    hand.id = 'W'; hand.wet = true;
    S.grainOverrides.pitchShift = 900;
    BV.syncWetVoicing();
    const p2 = pitchOf(w1), dp2 = pitchOf(d1);

    // Round trip: `wet` on the wire, honoured where the tile is wet, dried where it is not.
    S.particles.push({ lon: 0, lat: 0, strokeId: 1, _vo: w1, source: 'live',
                       liveBufferIdx: 0, grainStart: 0, grainDuration: 0.1, color: '#fff' });
    const built   = X.__testBuildPiece();
    const payload = JSON.parse(JSON.stringify(built.manifest));
    const list = payload.live?.voicings?.list || [];
    const wireWet = list.find(v => v.id === w1)?.wet === true;
    const wireDry = !('wet' in (list.find(v => v.id === d1) || { wet: 1 }));
    reset();
    await X.__testApplyPiece(payload, built.audio);
    const backWet = BV.voicingById(w1)?.wet === true && BV.voicingById(w1)?.tile === 'W';
    S._tileIsWet = () => false;
    reset();
    await X.__testApplyPiece(payload, built.audio);
    const backDried = BV.voicingById(w1)?.wet === false && pitchOf(w1) === p2;
    S._tileIsWet = id => id === 'W' && hand.wet;

    // Off dries where it sounds, and the next wet stroke is a NEW voicing.
    reset();
    S.grainOverrides.pitchShift = 100;
    US.recordStrokeStart('live', 0); const w3 = S.currentVoicing;
    const dried = BV.dryVoicing('W');
    const driedFlag = BV.voicingById(w3)?.wet === false;
    S.grainOverrides.pitchShift = 200;
    const syncAfterDry = BV.syncWetVoicing();
    const p3 = pitchOf(w3);
    US.recordStrokeStart('live', 0); const w4 = S.currentVoicing;
    const w4Wet = BV.voicingById(w4)?.wet === true;

    S._handTile = savedHand; S._tileIsWet = savedIsWet; S.grainOverrides.pitchShift = savedPitch ?? null;
    reset();
    return { w1, w2, wetFlag, p0, synced, p1, d1, dp0, syncedDry, dp1, p1b, p2, dp2,
             wireWet, wireDry, backWet, backDried, w3, dried, driedFlag, syncAfterDry, p3, w4, w4Wet };
  });
  check('a wet brush\'s strokes share one voicing', wet.w1 === wet.w2 && wet.wetFlag, `${wet.w1}/${wet.w2} wet=${wet.wetFlag}`);
  check('its knob moves that voicing in place', wet.synced === wet.w1 && wet.p0 === 0 && wet.p1 === 700,
    `sync→${wet.synced}, pitch ${wet.p0} → ${wet.p1}`);
  check('a dry brush in the hand syncs nothing', wet.syncedDry === 0 && wet.dp1 === wet.dp0 && wet.p1b === 700,
    `sync→${wet.syncedDry}, dry ${wet.dp0} → ${wet.dp1}, wet held at ${wet.p1b}`);
  check('back in the wet brush, its strokes move and the dry ones stay', wet.p2 === 900 && wet.dp2 === wet.dp0,
    `wet ${wet.p2}, dry ${wet.dp2}`);
  check('`wet` rides the session file, and only when true', wet.wireWet && wet.wireDry);
  check('imported onto a rig where the tile is wet, it stays wet', wet.backWet);
  check('imported onto a rig where the tile is dry, it dries with its last sound', wet.backDried);
  check('switching wet off dries the voicing where it sounds', wet.dried === 1 && wet.driedFlag && wet.syncAfterDry === 0 && wet.p3 === 100,
    `dried ${wet.dried}, wet=${!wet.driedFlag}, sync→${wet.syncAfterDry}, pitch ${wet.p3}`);
  check('the next wet stroke starts a new voicing', wet.w4 !== wet.w3 && wet.w4Wet, `${wet.w3} → ${wet.w4}`);

  // ── L2. the ring is the PAINT's, not the hand's ───────────────────────────
  // The regression this section exists for (Ek, 2026-09-14: "they only light
  // up wet with the extra ring when i'm painting with that tool but i imagine
  // that they should always look wet until i dry it"). The renderer keyed the
  // ring on `S._handTile()`, which is null between presses — so the one
  // question the ring answers, WHICH PAINT IS STILL WET, was answered only
  // while that brush was actually painting. Counted by its ink and its line
  // width, with the hand empty for every frame here.
  console.log('\n§ L2. a wet mark wears its ring with nothing in the hand');
  const wring = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const R  = await import('./js/renderer.js');
    const BV = await import('./js/brush-voicing.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const ctx = S.ctx, realStroke = ctx.stroke.bind(ctx);
    const ink = getComputedStyle(document.body).getPropertyValue('--eng-grain').trim().toLowerCase();
    const count = () => { let n = 0;
      ctx.stroke = (...a) => { const sc = String(ctx.strokeStyle).toLowerCase();
        if (sc === ink && Math.abs(ctx.lineWidth - 1) < 0.01) n++;
        return realStroke(...a); };
      try { R.drawFrame(); } finally { ctx.stroke = realStroke; }
      return n; };
    const keepParts = S.particles.slice(), keepVos = S.voicings, keepSeq = S.voicingSeq;
    const savedHand = S._handTile, savedIsWet = S._tileIsWet;
    let wet = -1, dry = -1;
    try {
      S.voicings = []; S.voicingSeq = 0; S.particles.length = 0;
      S._handTile = () => null;          // the brush is DOWN for every frame below
      S._tileIsWet = id => id === 'W';
      const vo = BV.voicingFor('W', 'W', true);
      for (const [lon, lat] of [[0.2, 0.1], [-0.2, -0.1]])
        S.particles.push({ lon, lat, _vo: vo, source: 'live', liveBufferIdx: 0,
                           grainStart: 0, grainDuration: 0.1, rms: 0.5, color: '#ffffff' });
      R.drawFrame(); await sleep(60);
      wet = count();
      BV.dryVoicing('W');                // dried: the same marks, no ring
      R.drawFrame(); await sleep(60);
      dry = count();
    } finally {
      S._handTile = savedHand; S._tileIsWet = savedIsWet;
      S.voicings = keepVos; S.voicingSeq = keepSeq;
      S.particles.length = 0; for (const p of keepParts) S.particles.push(p);
      R.drawFrame(); await sleep(60);
    }
    return { wet, dry, ink };
  });
  check('both marks of a wet brush ring while the hand is empty', wring.wet === 2, JSON.stringify(wring));
  check('drying them takes the ring off — the count discriminates', wring.dry === 0, JSON.stringify(wring));

  // ── M. The overdub brush ──────────────────────────────────────────────────
  console.log('\n§ M. the overdub brush — a take inside a pinned loop\'s cycle');
  const od = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G  = await import('./js/grain.js');
    const UP = await import('./js/ui-presets.js');
    const A  = await import('./js/audio.js');
    const B  = await import('./js/brush.js');
    const US = await import('./js/ui-samples.js');
    const X  = await import('./js/piece.js');
    const actx = A.ensureAudioContext();
    const sr = actx.sampleRate;
    const keepSlots = S.commitSlots.slice(), keepParts = S.particles.slice();
    const keepBufs = S.liveRecBuffers.slice(), keepHist = S.strokeHistory.slice();
    const keepTrig = (S.triggers || []).slice();
    const out = {};
    try {
      S.commitSlots = new Array(keepSlots.length).fill(null);
      S.particles.length = 0;
      S.strokeHistory = [];
      S.triggers = [];

      // A master built the way createSeqFromStroke builds one, with a running
      // source so the layer has a clock and a gain to join.
      const mkMaster = (i, lon, loopS, speed) => {
        const buf = actx.createBuffer(1, Math.round(loopS * sr), sr);
        const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
        const gain = actx.createGain(); gain.gain.value = 0; src.connect(gain); src.start();
        const seq = { type: 'loop', slotIndex: i, strokeId: 9000 + i, particles: [{ lon, lat: 0, grainStart: 0 }],
          buffer: buf, loopStart: 0, loopEnd: loopS, playheadIndex: 0, startOffset: 0, direction: 1,
          speed, playing: true, color: '#abcdef', anchorLon: lon, anchorLat: 0,
          _sourceNode: src, _gainNode: gain, _regionBuf: null, _startedAt: actx.currentTime - 13,
          grainParams: { volume: 1 } };
        S.commitSlots[i] = seq; return seq;
      };
      const mA = mkMaster(0, 0.0, 10, 1);
      const mB = mkMaster(1, 1.2, 10, 1);
      S.commitSlots[2] = { type: 'cloud', slotIndex: 2, playing: true, lon: 0.05, lat: 0, color: '#fff', grainParams: {}, grainOverrides: {} };

      // (a) nearest — loops only, no radius
      out.nearA = G.nearestLoopPin(0.1, 0);
      out.nearB = G.nearestLoopPin(1.1, 0);
      const { lon: cl, lat: cla } = UP.getCursorPos();
      out.begin = UP.beginOverdub();
      out.beginSeq = S._overdubTake?.seq === S.commitSlots[G.nearestLoopPin(cl, cla)];
      S._overdubTake = null;

      // (b) the master's clock: 13 s in at 1× on a 10 s loop is phase 3;
      //     at ½× the same 13 s is 13 of a 20 s cycle.
      out.phase1 = G.masterPhaseWall(mA, actx.currentTime);
      mA.speed = 0.5; out.phaseHalf = G.masterPhaseWall(mA, actx.currentTime); mA.speed = 1;

      // (c) the layer's maths: impulses at known times, folded at phase 3
      const T = await import('./js/take.js'); const take = (lenS, ...atS) => { const d = new Float32Array(Math.round(lenS * sr)); for (const t of atS) d[Math.round(t * sr)] = 1; return T.makeTake(d, sr); };
      const hits = (layer) => { const d = layer.getChannelData(0); const r = []; for (let i = 0; i < d.length; i++) if (d[i] !== 0) r.push([+(i / sr).toFixed(3), d[i]]); return r; };
      const L1 = UP.buildOverdubLayer(mA, take(2, 0.5, 1.5), 3);
      out.lay1 = { dur: +L1.duration.toFixed(3), hits: hits(L1) };
      const L2 = UP.buildOverdubLayer(mA, take(13, 0.5, 12.5), 9);            // wraps: 9.5 and 21.5→1.5
      out.lay2 = hits(L2);
      const L3 = UP.buildOverdubLayer(mA, take(25, 0.5, 10.5, 20.5), 0);      // three passes stack on 0.5
      out.lay3 = hits(L3);
      mA.speed = 0.5;
      const L4 = UP.buildOverdubLayer(mA, take(2, 0.5, 1.5), 3);              // ½×: 20 s cycle, spacing kept
      out.lay4 = { dur: +L4.duration.toFixed(3), hits: hits(L4) };
      mA.speed = 1;

      // (d) the real path: a take recorded through the trigger record pair
      //     with the overdub in flight — never armed, attached at the phase
      //     the recorder's clock says, layer running on the master's gain.
      if (!S.inputGainNode) S.inputGainNode = actx.createGain();
      if (!S.inputAnalyser) { S.inputAnalyser = actx.createAnalyser(); S.inputAnalyser.fftSize = 256; S.inputGainNode.connect(S.inputAnalyser); }
      const osc = actx.createOscillator(); const og = actx.createGain(); og.gain.value = 0.2;
      osc.connect(og); og.connect(S.inputGainNode); osc.start();
      window._rtAudioInputListening = true;
      S._overdubTake = { seq: mB };
      S._recordingTrigger = false;
      // The round trip pulls the phase back (js/latency.js): 30 ms here.
      const keepLat = S.latency; S.latency = { inS: 0.012, outS: 0.018, roundTripS: 0.03, source: 'measured', detail: 'test' };
      await S._startTriggerRecord();
      const sid = S.currentStrokeId;
      const tookOff = S.isRecording && S._recordingTrigger;
      const takeSlot = S.liveRecBuffers[S.currentLiveBufferIdx];
      // Independent of the function under test: wall seconds since the
      // master's origin, modulo its 10 s cycle at 1×.
      const expectPhase = ((((takeSlot?.startedAt ?? 0) - 0.03) - mB._startedAt) % 10 + 10) % 10;
      // Heard pass by pass: the wrap hook (what grain.js fires at each wrap
      // of the master) folds the take SO FAR into a provisional layer, and
      // a later wrap swaps a fresher one in under the crossfade.
      await new Promise(r => setTimeout(r, 300));
      const prov = S._overdubLiveWrap();
      const energy = b => { const d = b.getChannelData(0); let e = 0; for (let i = 0; i < d.length; i += 16) e += Math.abs(d[i]); return e; };
      const liveA = { n: mB.overdubs?.length | 0, live: !!prov?.live, src: !!prov?._src && !prov._src._stopped, swaps: prov?._swaps | 0,
        energy: prov ? +energy(prov.layer).toFixed(2) : 0, layerDur: prov ? +prov.layer.duration.toFixed(3) : null, same: prov === S._overdubTake?.ov,
        foldedS: prov ? +(prov.foldedS ?? -1).toFixed(2) : null,
        // heads walk the FOLDED length: a fold of 25 s on a 10 s cycle at phase 0.5 shows three
        heads: G.overdubHeads({ layer: prov?.layer, phase0: 0, foldedS: 25 }, 0.5, 25).length };
      await new Promise(r => setTimeout(r, 150));
      const firstSrc = prov?._src;
      S._overdubLiveWrap();
      const liveB = { n: mB.overdubs?.length | 0, swaps: prov?._swaps | 0, oldStopped: !!firstSrc?._stopped, newSrc: !!prov?._src && prov._src !== firstSrc && !prov._src._stopped };
      await new Promise(r => setTimeout(r, 150));
      S._stopTriggerRecord();
      await new Promise(res => A.whenSealed(res));
      await new Promise(r => setTimeout(r, 80));
      osc.stop();
      S.latency = keepLat;
      const ov = mB.overdubs?.[0];
      out.live = { a: liveA, b: liveB, sealedSame: ov === prov, sealedLive: !!ov?.live, sealedSwaps: ov?._swaps | 0, hasTake: !!ov?.buffer, foldedGone: !('foldedS' in (ov || {})) };
      out.real = { tookOff, n: mB.overdubs?.length | 0, sid: ov?.strokeId === sid, cleared: S._overdubTake === null,
        armed: (S.triggers || []).some(t => t.strokeId === sid), phaseErr: ov ? +Math.abs(ov.phase0 - expectPhase).toFixed(4) : null,
        layerDur: ov ? +ov.layer.duration.toFixed(3) : null, takeDur: ov ? +ov.buffer.duration.toFixed(2) : null,
        srcLoop: !!ov?._src?.loop, srcLive: !!ov?._src && !ov._src._stopped, inSlot: S.commitSlots.indexOf(mB) === 1 };

      // (e) undo takes the layer, leaves the master
      US.undoLastStroke();
      out.undo = { n: mB.overdubs.length, srcStopped: !!ov?._src?._stopped, master: S.commitSlots[1] === mB };

      // (f) export → import: the take and its phase travel; the layer is rebuilt
      mB.overdubs.push({ strokeId: 4242, phase0: 2.5, buffer: take(1, 0.25), layer: UP.buildOverdubLayer(mB, take(1, 0.25), 2.5), _src: null });
      const built   = X.__testBuildPiece();
    const payload = JSON.parse(JSON.stringify(built.manifest));
      const wire = payload.live?.commits?.find?.(c => c && c.slotIndex === 1) ?? (payload.commits || []).find(c => c && c.slotIndex === 1);
      out.wire = { n: wire?.overdubs?.length | 0, phase0: wire?.overdubs?.[0]?.phase0, hasAudio: !!wire?.overdubs?.[0]?.audio, noLayer: !('layer' in (wire?.overdubs?.[0] || {})) };
      await X.__testApplyPiece(payload, built.audio);
      const back = S.commitSlots.find(c => c && c.type === 'loop' && c.overdubs?.length);
      out.back = { n: back?.overdubs?.length | 0, phase0: back?.overdubs?.[0]?.phase0, layerDur: back ? +back.overdubs[0].layer.duration.toFixed(3) : null,
        hits: back ? hits(back.overdubs[0].layer) : null };

      // (g) stopping the master stops the family — and hands the overdubs
      //     back as ordinary lines: one trigger each, no audition, no looper
      //     hook, whatever tool is in the hand.
      const mC = mkMaster(3, 2.0, 4, 1);
      const ovC = { strokeId: 5151, phase0: 1, buffer: take(1, 0.1), layer: UP.buildOverdubLayer(mC, take(1, 0.1), 1), _src: null };
      mC.overdubs = [ovC]; G.startOverdubLayer(mC, ovC, actx);
      const live = !!ovC._src && !ovC._src._stopped;
      // the overdub's marks, on the sphere as an unarmed hit stroke; two, so
      // a slice or chop in the hand would show as more than one trigger
      for (let k = 0; k < 2; k++) { const p = { lon: 2.0 + 0.01 * k, lat: 0, strokeId: 5151, trig: true, source: 'live', liveBufferIdx: 0,
        grainStart: 0.2 * k, grainDuration: 0.1, color: '#fff' }; G.stampCartesian(p); S.particles.push(p); }
      S.liveRecBuffers[0] = S.liveRecBuffers[0] || { buffer: take(1, 0.1), grainCursor: 0 };
      const savedFx = S.brushFx, savedLoopOnEnd = S.triggerParams.loopOnEnd; S.brushFx = 'slice'; S.triggerParams.loopOnEnd = true;
      let hooked = 0; const savedHook = S._onTriggerStrokeArmed; S._onTriggerStrokeArmed = () => { hooked++; };
      const slotsBefore = S.commitSlots.filter(Boolean).length;
      UP.removeSeq(3, true);
      await new Promise(r => setTimeout(r, 120));
      const armed = (S.triggers || []).filter(t => t.strokeId === 5151);
      out.stop = { live, stopped: !!ovC._src?._stopped || ovC._src === null, armed: armed.length, hooked,
        marksKept: S.particles.filter(p => p.strokeId === 5151).length, noNewPin: S.commitSlots.filter(Boolean).length === slotsBefore - 1,
        primed: armed[0] ? !!armed[0].inside || armed[0].audition === false || true : false };
      S.brushFx = savedFx; S.triggerParams.loopOnEnd = savedLoopOnEnd; S._onTriggerStrokeArmed = savedHook;
      // (g2) a self-killing master takes the family's paint with it
      const mD = mkMaster(4, 2.5, 4, 1);
      mD.overdubs = [{ strokeId: 6161, phase0: 0, buffer: take(1, 0.1), layer: UP.buildOverdubLayer(mD, take(1, 0.1), 0), _src: null }];
      const pD = { lon: 2.5, lat: 0, strokeId: 6161, trig: true, source: 'live', liveBufferIdx: 0, grainStart: 0, grainDuration: 0.1, color: '#fff' }; G.stampCartesian(pD); S.particles.push(pD);
      UP.selfKillSlot(mD);
      out.kill = { marks: S.particles.filter(p => p.strokeId === 6161).length, armed: (S.triggers || []).filter(t => t.strokeId === 6161).length };

      // (d2) the master goes while the take runs: the stroke is handed back
      //      as a plain line at its seal, and no layer is left behind.
      const mE = mkMaster(5, 2.8, 4, 1);
      const osc2 = actx.createOscillator(); const og2 = actx.createGain(); og2.gain.value = 0.2; osc2.connect(og2); og2.connect(S.inputGainNode); osc2.start();
      S._overdubTake = { seq: mE, ov: null };
      await S._startTriggerRecord();
      const sid2 = S.currentStrokeId;
      await new Promise(r => setTimeout(r, 250));
      S._overdubLiveWrap();
      const hadProv = mE.overdubs?.length | 0;
      const p2 = { lon: 2.8, lat: 0, strokeId: sid2, trig: true, source: 'live', liveBufferIdx: S.currentLiveBufferIdx, grainStart: 0.05, grainDuration: 0.1, color: '#fff' }; G.stampCartesian(p2); S.particles.push(p2);
      UP.removeSeq(5, true);
      await new Promise(r => setTimeout(r, 100));
      const armedEarly = (S.triggers || []).some(t => t.strokeId === sid2);
      S._stopTriggerRecord();
      await new Promise(res => A.whenSealed(res));
      await new Promise(r => setTimeout(r, 80));
      osc2.stop();
      out.gone = { hadProv, armedEarly, armed: (S.triggers || []).filter(t => t.strokeId === sid2).length, orphanLayers: mE.overdubs?.length | 0, cleared: S._overdubTake === null };

      // (h) no master: the take SEEDS the loop (Ek, 2026-09-06) — the press
      //     starts like any tape take, with no master held and the seed flag
      //     up, so the looper hook pins it on release; the release clears
      //     the flag whatever the take came to.
      S.commitSlots = new Array(keepSlots.length).fill(null);
      const savedIs = S._handIsOverdub; S._handIsOverdub = () => true;
      const savedKey = S.brushKey; B.setBrush('tape');  // the overdub tile puts a tape brush in the hand
      B.gesturePress();
      out.seed = { active: B.gestureActive(), latched: !!S.paintLatched, seed: !!S._overdubSeed, take: S._overdubTake === null };
      B.gestureEnd();
      await new Promise(r => setTimeout(r, 80));
      out.seed.clearedAfter = !S._overdubSeed;
      S._handIsOverdub = savedIs; B.setBrush(savedKey);
    } finally {
      for (const c of S.commitSlots) if (c?.type === 'loop') G.releaseSeqNodes(c);
      S.commitSlots = keepSlots; S.particles = keepParts; S.liveRecBuffers = keepBufs; S.strokeHistory = keepHist; S.triggers = keepTrig;
      S._overdubTake = null; S._recordingTrigger = false;
      S._particleVersion = (S._particleVersion || 0) + 1;
    }
    return out;
  });
  check('the nearest pinned LOOP is the master — a nearer cloud does not count', od.nearA === 0 && od.nearB === 1, JSON.stringify([od.nearA, od.nearB]));
  check('beginOverdub holds the nearest loop at the press', od.begin === true && od.beginSeq === true, JSON.stringify([od.begin, od.beginSeq]));
  check('13 s into a 10 s loop at 1× is phase 3', Math.abs(od.phase1 - 3) < 0.02, String(od.phase1));
  check('… and at ½× it is 13 of a 20 s cycle — the playhead is the master\'s', Math.abs(od.phaseHalf - 13) < 0.02, String(od.phaseHalf));
  check('a 2 s take at phase 3 lands at 3.5 and 4.5 in a 10 s layer', od.lay1.dur === 10 && JSON.stringify(od.lay1.hits) === '[[3.5,1],[4.5,1]]', JSON.stringify(od.lay1));
  check('longer than the cycle, it wraps: 9.5 and 1.5', JSON.stringify(od.lay2) === '[[1.5,1],[9.5,1]]', JSON.stringify(od.lay2));
  check('three passes STACK on the same beat', JSON.stringify(od.lay3) === '[[0.5,3]]', JSON.stringify(od.lay3));
  check('½× master: a 20 s layer, the take unresampled (3.5 and 4.5, not 7 and 9)', od.lay4.dur === 20 && JSON.stringify(od.lay4.hits) === '[[3.5,1],[4.5,1]]', JSON.stringify(od.lay4));
  check('the real path: recording took off as a tape take', od.real.tookOff, JSON.stringify(od.real));
  check('… the take joined its master as ONE layer, and was never armed as a trigger', od.real.n === 1 && od.real.sid && !od.real.armed && od.real.inSlot, JSON.stringify(od.real));
  check('… phased by the recorder\'s clock against the master\'s, pulled back by the round trip', od.real.phaseErr !== null && od.real.phaseErr < 0.001, JSON.stringify(od.real));
  check('… the layer is one cycle long and running, looped, on the master', od.real.layerDur === 10 && od.real.srcLoop && od.real.srcLive && od.real.takeDur >= 0.4, JSON.stringify(od.real));
  check('… and the take in flight was cleared at the stroke\'s end', od.real.cleared, JSON.stringify(od.real));
  check('heard pass by pass: the first wrap folds the take so far into a provisional layer, running, one cycle long', od.live.a.n === 1 && od.live.a.live && od.live.a.src && od.live.a.swaps === 0 && od.live.a.energy > 0 && od.live.a.layerDur === 10 && od.live.a.same, JSON.stringify(od.live.a));
  check('… the next wrap swaps a fresher layer in: old source stopped, new one running, still one overdub', od.live.b.n === 1 && od.live.b.swaps === 1 && od.live.b.oldStopped && od.live.b.newSrc, JSON.stringify(od.live.b));
  check('… and the seal lands the final layer in the SAME overdub, no longer live', od.live.sealedSame && !od.live.sealedLive && od.live.sealedSwaps === 2 && od.live.hasTake, JSON.stringify(od.live));
  check('a live layer knows how much take it holds (the heads walk that, one per folded pass), and the seal drops the figure', od.live.a.foldedS > 0.2 && od.live.a.foldedS < od.live.a.layerDur && od.live.a.heads === 3 && od.live.foldedGone, JSON.stringify({ f: od.live.a.foldedS, h: od.live.a.heads, gone: od.live.foldedGone }));
  check('the master unpinned mid-take: not armed while still recording, a plain line at the seal, no layer left, take cleared', od.gone.hadProv === 1 && !od.gone.armedEarly && od.gone.armed === 1 && od.gone.orphanLayers === 0 && od.gone.cleared, JSON.stringify(od.gone));
  check('undo removes the layer and stops it; the master stays', od.undo.n === 0 && od.undo.srcStopped && od.undo.master, JSON.stringify(od.undo));
  check('the piece carries the take and its phase, not the layer', od.wire.n === 1 && od.wire.phase0 === 2.5 && od.wire.hasAudio && od.wire.noLayer, JSON.stringify(od.wire));
  check('import rebuilds the layer against the master\'s cycle', od.back.n === 1 && od.back.phase0 === 2.5 && od.back.layerDur === 10 && JSON.stringify(od.back.hits) === '[[2.75,1]]', JSON.stringify(od.back));
  check('removing the master stops its layers', od.stop.live && od.stop.stopped, JSON.stringify(od.stop));
  check('… and hands each overdub back as ONE plain line: armed once, marks kept, no slice under a slice tool, no looper hook, no new pin',
        od.stop.armed === 1 && od.stop.marksKept === 2 && od.stop.hooked === 0 && od.stop.noNewPin, JSON.stringify(od.stop));
  check('a self-killing master takes the family\'s paint with it, arming nothing', od.kill.marks === 0 && od.kill.armed === 0, JSON.stringify(od.kill));
  check('no loop pinned: the press starts a take with no master and the seed flag up — the looper hook will pin it — and the release clears the flag',
        od.seed.active && od.seed.seed && od.seed.take && od.seed.clearedAfter, JSON.stringify(od.seed));

  // ── M2. Erase reaches the overdub, and its head is drawn (Ek, 2026-09-05) ─
  // "If I erase an overdub … that part of the overdub stroke I erased should
  // not play" — the erased span is zeroed in the TAKE and the layer rebuilt
  // from it; the whole stroke gone takes the overdub off its master. And the
  // head maths the renderer draws from: one position per stacked pass.
  console.log('\n§ M2. erase reaches the overdub; the overdub has a head');
  const oe = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G  = await import('./js/grain.js');
    const UP = await import('./js/ui-presets.js');
    const A  = await import('./js/audio.js');
    const actx = A.ensureAudioContext();
    const sr = actx.sampleRate;
    const keepSlots = S.commitSlots.slice(), keepParts = S.particles.slice();
    const out = {};
    try {
      S.commitSlots = new Array(keepSlots.length).fill(null);
      S.particles = [];
      const T = await import('./js/take.js'); const take = (lenS, ...atS) => { const d = new Float32Array(Math.round(lenS * sr)); for (const t of atS) d[Math.round(t * sr)] = 1; return T.makeTake(d, sr); };
      const hits = (layer) => { const d = layer.getChannelData(0); const r = []; for (let i = 0; i < d.length; i++) if (d[i] !== 0) r.push([+(i / sr).toFixed(3), +d[i].toFixed(3)]); return r; };
      const buf = actx.createBuffer(1, Math.round(10 * sr), sr);
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = actx.createGain(); gain.gain.value = 0; src.connect(gain); src.start();
      const m = { type: 'loop', slotIndex: 0, strokeId: 9100, particles: [{ lon: 0, lat: 0, grainStart: 0 }], buffer: buf, loopStart: 0, loopEnd: 10,
        playheadIndex: 0, startOffset: 0, direction: 1, speed: 1, playing: true, color: '#abcdef', anchorLon: 0, anchorLat: 0,
        _sourceNode: src, _gainNode: gain, _regionBuf: null, _startedAt: actx.currentTime - 13.5, grainParams: { volume: 1 } };
      S.commitSlots[0] = m;
      // a 2 s take with a hit at 0.5 and at 1.5, folded at phase 3 → 3.5 and 4.5
      const ov = { strokeId: 7171, phase0: 3, buffer: take(2, 0.5, 1.5), layer: null, _src: null, _gain: null };
      ov.layer = UP.buildOverdubLayer(m, ov.buffer, 3);
      m.overdubs = [ov]; G.startOverdubLayer(m, ov, actx);
      const mk = (t, k) => { const p = { lon: 0.5 + 0.01 * k, lat: 0, strokeId: 7171, trig: true, source: 'live', liveBufferIdx: 0, grainStart: t, grainDuration: 0.1, color: '#fff' }; G.stampCartesian(p); S.particles.push(p); return p; };
      const pA = mk(0.5, 0), pB = mk(1.5, 1);
      // the master's own marks, and a hit in its buffer to see silenced
      const mkM = (t, k) => { const p = { lon: 0.0 + 0.01 * k, lat: 0, strokeId: 9100, trig: true, source: 'live', liveBufferIdx: 0, grainStart: t, grainDuration: 0.1, color: '#fff' }; G.stampCartesian(p); S.particles.push(p); return p; };
      const mA = mkM(0, 0), mB2 = mkM(5, 1);
      buf.getChannelData(0)[Math.round(2 * sr)] = 1;
      out.before = { hits: hits(ov.layer), srcLive: !!ov._src && !ov._src._stopped };
      // the head: master 13.5 s in → phase 3.5 → 0.5 s into the take
      out.heads1 = G.overdubHeads(ov, G.masterPhaseWall(m, actx.currentTime), ov.buffer.duration).map(t => +t.toFixed(2));
      out.heads3 = G.overdubHeads({ layer: ov.layer, phase0: 3 }, 3.5, 25).map(t => +t.toFixed(2));
      // the MASTER's whole stroke erased while its overdub stands: silenced,
      // still cycling (Ek: "the loop cycling should continue")
      S.particles = S.particles.filter(p => p !== mA && p !== mB2); S._particleVersion++;
      S._onMarksErased([mA, mB2]);
      out.masterGone = { cycling: !src._stopped && !m._fadingOut && S.commitSlots[0] === m, silent: buf.getChannelData(0)[Math.round(2 * sr)] === 0,
        n: m.overdubs.length, layerLive: !!ov._src && !ov._src._stopped };
      // erase the first mark (the erase path removes it, then calls the hook)
      const firstSrc = ov._src;
      S.particles = S.particles.filter(p => p !== pA); S._particleVersion = (S._particleVersion || 0) + 1;
      S._onMarksErased([pA]);
      const e = ov.buffer.data;
      out.part = { n: m.overdubs.length, hits: hits(ov.layer), takeAt05: +e[Math.round(0.5 * sr)].toFixed(3), takeAt15: +e[Math.round(1.5 * sr)].toFixed(3),
        swapped: ov._src !== firstSrc && !!ov._src && !ov._src._stopped, oldStopped: !!firstSrc?._stopped };
      // erase the rest: the overdub leaves its master
      const secondSrc = ov._src;
      S.particles = S.particles.filter(p => p !== pB); S._particleVersion++;
      S._onMarksErased([pB]);
      out.all = { n: m.overdubs.length, stopped: !!secondSrc?._stopped, masterReleased: !!m._fadingOut || S.commitSlots[0] !== m };
    } finally {
      for (const c of S.commitSlots) if (c?._sourceNode) { try { c._sourceNode.stop(); } catch (_) {} }
      S.commitSlots = keepSlots; S.particles = keepParts; S._particleVersion++;
    }
    return out;
  });
  check('setup: a 2 s take folded at phase 3 lands at 3.5 and 4.5, its layer running', JSON.stringify(oe.before.hits) === '[[3.5,1],[4.5,1]]' && oe.before.srcLive, JSON.stringify(oe.before));
  check('the head: master 3.5 s into its cycle reads 0.5 s into the take', oe.heads1.length === 1 && Math.abs(oe.heads1[0] - 0.5) < 0.05, JSON.stringify(oe.heads1));
  check('… and a 25 s take on a 10 s cycle has three heads, one per stacked pass', JSON.stringify(oe.heads3) === '[0.5,10.5,20.5]', JSON.stringify(oe.heads3));
  check('erasing one mark silences that span in the take and rebuilds the layer without it, swapped in under the seam', oe.part.n === 1 && JSON.stringify(oe.part.hits) === '[[4.5,1]]' && oe.part.takeAt05 === 0 && oe.part.takeAt15 === 1 && oe.part.swapped && oe.part.oldStopped, JSON.stringify(oe.part));
  check('the master\'s whole stroke erased under a standing overdub: silenced, still cycling, the layer still live', oe.masterGone.cycling && oe.masterGone.silent && oe.masterGone.n === 1 && oe.masterGone.layerLive, JSON.stringify(oe.masterGone));
  check('erasing the last overdub\'s whole stroke takes it off its master — and releases the master, whose own stroke was already gone', oe.all.n === 0 && oe.all.stopped && oe.all.masterReleased, JSON.stringify(oe.all));

  // ── M3. An erased mark silences ITS window — to the next mark, not a grain length ──
  // Ek, 2026-09-10: erasing a tape line took the right bite visually and
  // "a bit less than a second more on the downstream edge" in audio. The
  // span used to end at grainStart + grainDuration, the brush's GRANULAR
  // grain length; a mark stands for the take up to the next mark.
  console.log('\n§ M3. an erased mark silences the take to the NEXT mark, not a grain length past it');
  const es = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G  = await import('./js/grain.js');
    const UP = await import('./js/ui-presets.js');
    const A  = await import('./js/audio.js');
    const actx = A.ensureAudioContext();
    const sr = actx.sampleRate;
    const keepSlots = S.commitSlots.slice(), keepParts = S.particles.slice();
    const out = {};
    try {
      S.commitSlots = new Array(keepSlots.length).fill(null);
      S.particles = [];
      // a 4 s loop buffer with a hit halfway through each of four 1 s windows
      const buf = actx.createBuffer(1, Math.round(4 * sr), sr);
      const d = buf.getChannelData(0);
      for (const t of [0.5, 1.5, 2.5, 3.5]) d[Math.round(t * sr)] = 1;
      const at = t => +d[Math.round(t * sr)].toFixed(3);
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = actx.createGain(); gain.gain.value = 0; src.connect(gain); src.start();
      // marks at 0, 1, 2, 3 — each with a 1.7 s grainDuration, which the old
      // rule would have read as "this mark covers 1.7 s"
      const marks = [0, 1, 2, 3].map((t, k) => { const p = { lon: 0.1 * k, lat: 0, strokeId: 9300, trig: true, source: 'live', liveBufferIdx: 0, grainStart: t, grainDuration: 1.7, color: '#fff' }; G.stampCartesian(p); S.particles.push(p); return p; });
      const copies = marks.map(p => ({ lon: p.lon, lat: p.lat, grainStart: p.grainStart, grainDuration: p.grainDuration }));
      const m = { type: 'loop', slotIndex: 0, strokeId: 9300, particles: copies, buffer: buf, loopStart: 0, loopEnd: 4,
        playheadIndex: 0, startOffset: 0, direction: 1, speed: 1, playing: true, color: '#abcdef', anchorLon: 0, anchorLat: 0,
        _sourceNode: src, _gainNode: gain, _regionBuf: null, _startedAt: actx.currentTime, grainParams: { volume: 1 } };
      S.commitSlots[0] = m;
      // erase the mark at 1 s: only its window, [1, 2), goes quiet
      S.particles = S.particles.filter(p => p !== marks[1]); S._particleVersion++;
      S._onMarksErased([marks[1]]);
      out.mid = { h05: at(0.5), h15: at(1.5), h25: at(2.5), h35: at(3.5), silenced: copies.map(c => !!c._silenced) };
      // erase the LAST mark: its window runs to the end of the buffer
      S.particles = S.particles.filter(p => p !== marks[3]); S._particleVersion++;
      S._onMarksErased([marks[3]]);
      out.last = { h05: at(0.5), h25: at(2.5), h35: at(3.5), end: +d[d.length - 1].toFixed(3), stillPinned: S.commitSlots[0] === m && !src._stopped };
    } finally {
      for (const c of S.commitSlots) if (c?._sourceNode) { try { c._sourceNode.stop(); } catch (_) {} }
      S.commitSlots = keepSlots; S.particles = keepParts; S._particleVersion++;
    }
    return out;
  });
  check('erasing the mark at 1 s silences [1, 2) only: the hit at 1.5 goes, 0.5, 2.5 and 3.5 stay (the old rule took 2.5 too)',
        es.mid.h15 === 0 && es.mid.h05 === 1 && es.mid.h25 === 1 && es.mid.h35 === 1 && JSON.stringify(es.mid.silenced) === '[false,true,false,false]', JSON.stringify(es.mid));
  check('erasing the last mark silences from it to the end of the buffer, and the loop keeps cycling', es.last.h35 === 0 && es.last.h05 === 1 && es.last.h25 === 1 && es.last.stillPinned, JSON.stringify(es.last));

  // ── N. The deferred path — `on end: cloud`, the wash (Ek, 2026-09-05) ────
  // A stroke that ends as a cloud records its path from the press but has NO
  // slot until the release: while it is painted only the cursor reads it.
  // startSeedPlant (the `=` hold) is the other contract — a ghost pin sounds
  // at once — and both finalize through the one function.
  console.log('\n§ N. the deferred path — no cloud while the stroke runs, a moving cloud at the release');
  const dp = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const UP = await import('./js/ui-presets.js');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const clouds = () => S.commitSlots.filter(c => c && c.type === 'cloud');
    const n0 = clouds().length;
    UP.startSeedPath();
    // The scheduler ticks the recording at ~15 fps; drive it too, in case the
    // audit rig's context is suspended.
    for (let i = 0; i < 6; i++) { await wait(60); UP.tickSeedRecording(); }
    const mid = { deferred: !!S._commitRecordingDeferred, clouds: clouds().length - n0, frames: S._commitRecordingFrames?.length ?? 0 };
    UP.finalizeSeedPlant();
    const made = clouds().filter(c => !(c._plantedAt < performance.now() / 1000 - 5));
    const c = made[made.length - 1];
    const end = { deferred: !!S._commitRecordingDeferred, clouds: clouds().length - n0, moving: !!(c && c.frames && c.frames.length >= 2), dur: c?.duration ?? 0,
                  // plays from its first frame; ANCHORED at its last, where the hand let go (2026-09-05)
                  anchored: !!c && c.lon === c.frames?.[0]?.lon && c.lat === c.frames?.[0]?.lat
                            && c.anchorLon === c.frames?.[c.frames.length - 1]?.lon && c.anchorLat === c.frames?.[c.frames.length - 1]?.lat,
                  t0: c?.frames?.[0]?.t ?? -1 };
    // The stroke's end is what finalizes it — keyed on the recording in flight.
    const wasP = S.isPainting, sid = S.currentStrokeId; S.currentStrokeId = 777001;
    UP.startSeedPath(); await wait(30);
    S.isPainting = true; S.currentStrokeId = -1;
    S._stopPaintStroke(); S.isPainting = wasP;
    const washed = clouds().find(c => c.strokeId === 777001);
    const viaStroke = { deferred: !!S._commitRecordingDeferred, clouds: clouds().length - n0, tagged: !!washed };
    // Undo of the stroke takes the cloud with it (Ek, 2026-09-05).
    UP.removeSeqByStrokeId(777001);
    const undone = { clouds: clouds().length - n0, gone: !clouds().some(c => c.strokeId === 777001) };
    S.currentStrokeId = sid;
    // A full pool refuses at the release, and the stroke stays scratch.
    const cnt = S.commitSlotCount, ovf = S.commitOverflow; S.commitSlotCount = 0; S.commitOverflow = 'off';
    UP.startSeedPath(); await wait(30); UP.finalizeSeedPlant();
    const full = { deferred: !!S._commitRecordingDeferred, clouds: clouds().length - n0, frames: S._commitRecordingFrames };
    S.commitSlotCount = cnt; S.commitOverflow = ovf;
    for (const x of clouds()) if (!(x._plantedAt < performance.now() / 1000 - 5)) S.commitSlots[S.commitSlots.indexOf(x)] = null;
    return { mid, end, viaStroke, undone, full };
  });
  check('while the path records there is NO cloud, only frames', dp.mid.deferred && dp.mid.clouds === 0 && dp.mid.frames >= 3, JSON.stringify(dp.mid));
  check('the release makes ONE moving cloud, playing from its first frame, anchored at its last, the clock starting at the press', dp.end.clouds === 1 && dp.end.moving && dp.end.dur > 200 && dp.end.anchored && dp.end.t0 >= 0 && dp.end.t0 < 50 && !dp.end.deferred, JSON.stringify(dp.end));
  check('the stroke\'s end finalizes it (a short one: a stationary cloud), tagged with the stroke', !dp.viaStroke.deferred && dp.viaStroke.clouds === 2 && dp.viaStroke.tagged, JSON.stringify(dp.viaStroke));
  check('undo of the stroke takes the cloud with it', dp.undone.clouds === 1 && dp.undone.gone, JSON.stringify(dp.undone));
  check('a full pool refuses at the release: no cloud, nothing left recording', !dp.full.deferred && dp.full.clouds === 1 && dp.full.frames === null, JSON.stringify(dp.full));

  console.log('\n§ J2. the selected pin is framed on the sphere');
  // Ek, 2026-09-13: "besides the pinned item being selected and highlighted in
  // the right side rail, i want there to be some indication on what's
  // highlighted in the viz sphere." Four corner brackets in the pin family's
  // bone, drawn AROUND the selected pin — a cloud or a loop. The loop passes
  // did not know the selection at all before this, so selecting a loop in the
  // rail changed nothing out here. Counted by its ink and its line width,
  // which together are the bracket and nothing else on the frame.
  const bracket = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const R = await import('./js/renderer.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const ctx = S.ctx, realStroke = ctx.stroke.bind(ctx);
    const ink = getComputedStyle(document.body).getPropertyValue('--eng-pins').trim().toLowerCase();
    const count = () => { let n = 0;
      ctx.stroke = (...a) => { const sc = String(ctx.strokeStyle).toLowerCase();
        if ((sc === ink || sc === 'rgb(207, 199, 188)') && Math.abs(ctx.lineWidth - 1.6) < 0.01) n++;
        return realStroke(...a); };
      try { R.drawFrame(); } finally { ctx.stroke = realStroke; }
      return n; };
    // SWAP THE ARRAY, never clear it: clearAllCommits DESTROYS the pins, and
    // § K below needs the ones this suite already made (it read 775 → 775 and
    // failed on the drop it asserts, 2026-09-13). Pointing S.commitSlots at an
    // empty array for two frames disturbs nothing.
    // Entries, never the ARRAY: other modules hold a reference to it and
    // swapping the identity left § K reading 775 → 775 (2026-09-13).
    const keepSlots = S.commitSlots.slice();
    for (let i = 0; i < S.commitSlots.length; i++) S.commitSlots[i] = null;
    R.drawFrame(); await sleep(60);
    const none = count();
    // two loops, and the cursor parked on each in turn
    // `playing: false` and a grainParams block: the scheduler walks a PLAYING
    // loop and wants its gain, and this section is about what is DRAWN. The
    // anchor pass draws a stopped loop too, at 0.4 alpha, so the bracket is
    // still on the frame.
    const loop = (i, lon, lat) => ({ type: 'loop', slotIndex: i, playing: false,
      color: '#f2569e', anchorLon: lon, anchorLat: lat, grainParams: { volume: 1 },
      particles: [{ lon, lat }], playheadIndex: 0 });
    S.commitSlots[0] = loop(0, 0.2, 0.1);
    S.commitSlots[1] = loop(1, -0.3, -0.1);
    R.drawFrame(); await sleep(60);
    const withPins = count();
    const sel = S._selectedPinSlot?.(S._frameCursorLon ?? 0, S._frameCursorLat ?? 0);
    for (let i = 0; i < keepSlots.length; i++) S.commitSlots[i] = keepSlots[i];
    R.drawFrame(); await sleep(80);
    return { none, withPins, sel, ink };
  });
  check('no pins, no bracket', bracket.none === 0, JSON.stringify(bracket));
  check('a selected LOOP wears exactly one bracket — the pass that never knew the selection',
        bracket.withPins === 1, JSON.stringify(bracket));

  console.log('\n§ J3. one selected pin, three marks that agree');
  // The rail's SELECTED frame, the tracker's ring and the sphere's bracket all say
  // "this one", and they must say it about the SAME pin (Ek, 2026-09-14: "if
  // it's the closest one highlight it as so in the tracker"). Each reads
  // `selectedPinSlot`, so the way this breaks is not a disagreement about the
  // rule but two SEARCHES a few milliseconds apart while the cursor moves —
  // which is why the rail's tick does one search and hands it to both painters.
  // The cell also has to name the pin the row names: `loop 3` is the pin in
  // slot 3, and a tracker that numbered its own cells independently of
  // `_pinName` would drift the moment either changed.
  const marks = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const TL = await import('./js/tile-layout.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const wasOpen = document.body.classList.contains('pinned-open');
    TL.setPinnedRail(true);
    const keep = S.commitSlots.slice(), wasMode = S.selectionMode;
    for (let i = 0; i < S.commitSlots.length; i++) S.commitSlots[i] = null;
    S.selectionMode = 'nearest';
    const lon = S._frameCursorLon ?? 0, lat = S._frameCursorLat ?? 0;
    // Three pins at rising distance, so "nearest" has one right answer and it
    // is NOT the first slot — a tracker that just rang cell 0 would pass.
    const pin = (type, i, d) => ({ type, slotIndex: i, playing: false, mute: false, solo: false,
      color: '#f2569e', lon: lon + d, lat, anchorLon: lon + d, anchorLat: lat,
      grainParams: { volume: 1 }, particles: [{ lon: lon + d, lat }], playheadIndex: 0,
      _plantedAt: performance.now() / 1000, _createdAt: performance.now() / 1000, _releasingAt: 0 });
    S.commitSlots[0] = pin('loop',  0, 0.30);
    S.commitSlots[1] = pin('loop',  1, 0.05);   // ← nearest
    S.commitSlots[2] = pin('cloud', 2, 0.60);
    S._pinsDirty = true;
    await sleep(500);
    // THE MIXER (2026-09-16): sort IS the selected pin. The tracks are laid
    // out by transform in `S.selectionMode` order, so the selected pin is the
    // inside the SELECTED frame (`.sel`, row one) AND the one at the top.
    const rows = [...document.querySelectorAll('#lyrList .lyr-trk')];
    const yOf = el => { const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform || ''); return m ? +m[1] : 0; };
    rows.sort((a, b) => yOf(a) - yOf(b));
    const row = document.querySelector('.lyr-trk.sel');
    const out = {
      want:   S._selectedPinSlot?.(lon, lat),
      row:    row ? +row.dataset.slot : -1,
      first:  rows.length ? +rows[0].dataset.slot : -1,
      n:      rows.length,
      // A track's number is its slot's, the same digit the sphere wears.
      digits: rows.every(r => r.querySelector('.lyr-num')?.textContent.trim() === String(+r.dataset.slot + 1)),
    };
    for (let i = 0; i < keep.length; i++) S.commitSlots[i] = keep[i];
    S.selectionMode = wasMode;
    S._pinsDirty = true;
    if (!wasOpen) TL.setPinnedRail(false);
    await sleep(200);
    return out;
  });
  check('the nearest pin is the selected one, and it is not simply the first slot',
        marks.want === 1, JSON.stringify(marks));
  check('the rail marks the pin unpin takes', marks.row === marks.want, JSON.stringify(marks));
  check('… and under `nearest` it is row one — sort is the selected pin',
        marks.n === 3 && marks.first === marks.want, JSON.stringify(marks));
  check('every track is numbered by its slot', marks.digits === true, JSON.stringify(marks));

  check('no renderer errors after exercise', rig.errors().length === 0, rig.errors().join(' | '));

  console.log(`\n${pass} ok · ${fail} failed`);
  return fail;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let fail = 1;
    try { fail = await run(rig); } finally { await rig.close(); }
    process.exit(fail ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}
