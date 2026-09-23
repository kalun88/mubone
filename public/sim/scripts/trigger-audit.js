#!/usr/bin/env node
/**
 * scripts/trigger-audit.js — headless checks for the trigger tool.
 *
 * Runs against a real Electron instance via scripts/lib/rig.js — no setup, no
 * server, no browser download. The instance is launched muted on its own
 * profile and OSC port, so it cannot touch your presets or a live station.
 *   node scripts/trigger-audit.js
 *   node scripts/rig-audit.js          # this plus the other suites, one boot
 *
 * The cost figures in section E are now measured on the audio-thread build the
 * rig actually runs, which is the only place the 20 ms budget means anything.
 *
 * The model being tested: whether a buffer is trigger or granular material is
 * decided before recording and is fixed for its life. A trigger is a *view*
 * onto a painted stroke — the particles are the live ones in S.particles, the
 * buffer is the stroke's source buffer. Nothing is copied. That is what makes
 * erase, undo and delete-all work on triggers with no special cases, and it is
 * the property most of these checks defend.
 *
 * What it covers, and why these and not others:
 *
 *  A. Boot — module loads, hooks registered, panel present, no page errors.
 *  B. Typing — trigger particles are excluded from BOTH granular candidate
 *     pools (radius and nearest) and granular particles are not. This is the
 *     "never both" rule, and it is the one a future refactor is most likely to
 *     break silently, because the symptom is a doubled sound rather than a
 *     crash.
 *  C. The gate — enter/exit edges, the hysteresis band from both directions,
 *     the rearm window, the bounding-cap early-out. Pure geometry and integer
 *     time, so fully testable without audio. The hysteresis band is the case
 *     worth having a test for: the same distance must give a different answer
 *     depending on which side the cursor came from.
 *  D. Material lifecycle — erase trims the sample, erasing it all removes the
 *     trigger, erasing the middle splits it. These are the behaviours
 *     that come from NOT copying, so they are the ones that would regress if
 *     someone reintroduced copies.
 *  E. Cost — the gate timed at 0/1/8/32 triggers. Not a threshold; the number
 *     is the point, because the budget is the 20 ms scheduler tick.
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
  // This suite drives the engine with synthetic cursor positions and integer
  // timestamps, so it has to own the tick — see rig.quiesce().
  await rig.quiesce();

  // ── A. Boot ───────────────────────────────────────────────────────────────
  console.log('\n§ boot');
  const boot = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    return {
      hasS:      !!S,
      triggers:  Array.isArray(S?.triggers),
      capped:    S?.scanMuted,
      noTrigMuted: S?.trigMuted === undefined,
      recFlag:   S?._recordingTrigger,
      params:    S?.triggerParams ? Object.keys(S.triggerParams).sort() : null,
      noDefaults: S?.triggerDefaults === undefined,
      gate:      typeof S?._updateTriggerGates,
      arm:       typeof S?._armTrigger,
      silence:   typeof S?._silenceTriggers,
      setChop:   typeof S?._setChopOn,
      clearAll:  typeof S?._clearAllTriggers,
      onEnded:   typeof S?._onTriggerSourceEnded,
      panel:     !!document.querySelector('.device--trigger'),
      noMuteBtn: !document.getElementById('trigMuteBtn'),
      // No tool picker and no disarm: the type is chosen at record time and
      // erase is the delete.
      noToolSeg:  !document.getElementById('toolModeSeg'),
      noDisarm:   !document.getElementById('trigDisarmBtn'),
      noToolMode: S?.toolMode === undefined,
    };
  });

  if (!boot.hasS) {
    console.log('  FAIL could not import js/state.js — nothing else can be checked.');
    return 1;
  }

  check('S.triggers is an array', boot.triggers);
  check('hits start live — the cap is off at boot', boot.capped === false);
  check('there is no second mute: the cap absorbed it (2026-09-07)', boot.noTrigMuted);
  check('trigger-recording flag starts clear', boot.recFlag === false);
  // 16 since 2026-09-18: `reverse`, `pitch` and `step` are the tape's own
  // baked half (docs/TAPE-STUDY-2026-09.md) and `dubDecay` is the dub's. 12
  // before that — `layerGroup` went with the named pin groups on 2026-08-30,
  // a loop joins the loops group by being a loop. No radius: a trigger
  // follows the search radius.
  check('triggerParams has all 16 fields',
    JSON.stringify(boot.params) === JSON.stringify(
      // `chop` / `chopOn` became `sliceOn` (2026-09-22, the slice switch);
      // `releaseMs` joined the same night (the release fade's own length).
      ['dubDecay', 'dwell', 'hysteresis', 'loopOnEnd', 'passes', 'pitch',
       'rearmMs', 'release', 'releaseMs', 'retrig', 'reverse', 'sliceOn', 'speed', 'start', 'step', 'volume']),
    JSON.stringify(boot.params));
  check('no triggerDefaults — playback params are live, not baked in', boot.noDefaults);
  check('gate registered on S', boot.gate === 'function');
  check('arm registered on S', boot.arm === 'function');
  check('the silencer the cap calls is registered on S', boot.silence === 'function');
  check('chop toggle registered on S', boot.setChop === 'function');
  check('clear-all registered on S', boot.clearAll === 'function');
  check('one-shot end hook registered on S', boot.onEnded === 'function');
  check('trigger panel present, and its old on/off button is gone', boot.panel && boot.noMuteBtn);
  check('no tool-mode picker (type is chosen at record time)', boot.noToolSeg && boot.noToolMode);
  check('no disarm control (erase is the delete)', boot.noDisarm);
  check('no renderer errors on boot', rig.errors().length === 0, rig.errors().join(' | '));

  // ── B/C/D. Behaviour ──────────────────────────────────────────────────────
  const r = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const grain = await import('./js/grain.js');
    const { armTrigger } = await import('./js/trigger.js');
    const out = {};

    // A stroke of particles laid along the equator, painted from a fake live
    // buffer. `trig` is what the record button stamps on.
    let nextStroke = 100;
    function paintStroke({ trig, centreLon = 0, span = 0.05, n = 40 }) {
      const sid = ++nextStroke;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const p = {
          lon: centreLon + f * span, lat: 0,
          strokeId: sid, source: 'live', liveBufferIdx: 0,
          grainStart: i * 0.05,
          // Deliberately much longer than the spacing — a wash-type patch uses
          // grain lengths of seconds. The region end must NOT include this: a
          // trigger particle marks a position in the recording, not a grain.
          grainDuration: 2.0,
        };
        if (trig) p.trig = true;
        grain.stampCartesian(p);
        S.particles.push(p);
      }
      S._particleVersion++;
      return sid;
    }

    // A real AudioBuffer so the region maths has something to clamp against.
    // Eight seconds, not three: _applyCluster clamps a region to buffer.duration
    // and rejects it when nothing is left (js/trigger.js:181), so the chop take
    // below — four bursts a second apart, ending near 5.9 s — silently lost its
    // last two segments against a 3 s buffer and read as a chop bug.
    const TK = await import('./js/take.js');
    S.liveRecBuffers = [{ buffer: TK.makeTake(new Float32Array(44100 * 8), 44100), liveBuffer: null, grainCursor: 0 }];
    S.particles.length = 0;
    S.triggers.length = 0;
    S.scanMuted = false;

    // ── B. Typing: never both ────────────────────────────────────────────
    const trigSid = paintStroke({ trig: true,  centreLon: 0 });
    const granSid = paintStroke({ trig: false, centreLon: 0.02 });

    // Straight through the real builders via the test seam — scheduleGrains()
    // returns early without a running AudioContext, which headless can't get.
    S.searchRadiusDeg = 30;
    S.recencyN = 0;
    const radiusPool = grain.__testCandidatePool(0, 0);
    out.radiusPoolHasGranular = radiusPool.some(p => p.strokeId === granSid);
    out.radiusPoolHasTrigger  = radiusPool.some(p => p.strokeId === trigSid);

    // Nearest mode ignores the radius entirely — the rule has to hold there too,
    // or a trigger stroke gets granulated the moment it is the closest thing.
    const nearPool = grain.__testCandidatePool(0, 0, { nearest: true, k: 60 });
    out.nearestPoolHasGranular = nearPool.some(p => p.strokeId === granSid);
    out.nearestPoolHasTrigger  = nearPool.some(p => p.strokeId === trigSid);

    // dwell:'grain' is the ONE exception — stop on a trigger and its material
    // opens up to the granular cursor. Both pools have to honour it, and both
    // have to close again when dwell moves off 'grain'.
    //
    // PLAY ONCE, THEN OPEN (2026-09-18, RULINGS): arriving must NOT open it —
    // that is what made the grains sound over the take's own first pass — the
    // playthrough's END does, which is `onTriggerSourceEnded` adding the
    // stroke to `S._openStrokes` with the cursor still on it.
    S.triggerParams.dwell = 'grain';
    out.grainDwellArrivalShut = !grain.__testCandidatePool(0, 0)
      .some(p => p.strokeId === trigSid);
    S._openStrokes.add(trigSid);              // the take has played through
    out.grainDwellRadiusOpens = grain.__testCandidatePool(0, 0)
      .some(p => p.strokeId === trigSid);
    out.grainDwellNearestOpens = grain.__testCandidatePool(0, 0, { nearest: true, k: 60 })
      .some(p => p.strokeId === trigSid);
    // Nearest mode has no radius, so a trigger far from the cursor must NOT be
    // opened up — the shortcut that makes the radius path safe doesn't hold there.
    const farPool = grain.__testCandidatePool(Math.PI, 0, { nearest: true, k: 60 });
    out.grainDwellNearestStillBounded = !farPool.some(p => p.strokeId === trigSid);
    // And WHAT the opened trigger reads with: the live grain block (region 0
    // of the candidate tables), never the grain voicing its hit brush froze
    // at recording time (2026-09-06). Read back from the tables the bridge
    // wrote for this pool.
    {
      const B = await import('./js/grain-worklet-bridge.js');
      // The bridge resolves a mark's buffer through _bufferMap and names a
      // row by the mark's global index: map this take and stamp the indices,
      // as the scheduler and a hot-swap would have.
      if (!S.liveRecBuffers[0]?.buffer) {
        const actx = S.audioCtx; const b = TK.makeTake(new Float32Array(actx.sampleRate * 8), actx.sampleRate);
        S.liveRecBuffers[0] = { ...(S.liveRecBuffers[0] || {}), buffer: b, grainCursor: 0 };
      }
      // The engine is not up yet in this section: bring the worklet up for
      // this take, as the probe does for its sample, then map it.
      await S._ensureWorkletForSample?.(S.liveRecBuffers[0].buffer);
      B.hotSwapSample(S.liveRecBuffers[0].buffer);
      await new Promise(r => setTimeout(r, 200));
      out.dwellDiag = { worklet: B.isWorkletGrainActive(), bufMap: B.getWorkletDiag()?.bufMapSize, tables: B.getWorkletDiag()?.tables, bufs: S.liveRecBuffers.length };
      S.particles.forEach((p, i) => { p._globalIdx = i; });
      const pool = grain.__testCandidatePool(0, 0);
      for (const p of pool) if (p.strokeId === trigSid) p._vo = 4242;   // a voicing it must NOT read with
      S._postWorkletCandidates?.(pool, 0, 0);
      const rows = B.getWorkletDiag()?.candidates ?? [];
      const trigRows = rows.filter(r => S.particles[r.particleId]?.strokeId === trigSid);
      out.dwellReadsLive = trigRows.length > 0 && trigRows.every(r => r.region === 0);
      out.dwellRows = trigRows.length; out.dwellAllRows = rows.length;
    }
    // Leaving the dwell closes every open stroke at once — the set is only
    // ever consulted under `grain`, so no gate tick is needed for this.
    S.triggerParams.dwell = 'oneshot';
    out.grainDwellClosesAgain = !grain.__testCandidatePool(0, 0)
      .some(p => p.strokeId === trigSid);
    S._openStrokes.clear();

    // ── C. The gate ──────────────────────────────────────────────────────
    S.particles.length = 0;
    S.triggers.length = 0;
    const sid = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
    // Reach comes from the cursor's search radius, not a trigger-owned one.
    S.searchRadiusDeg = 8;
    Object.assign(S.triggerParams, {
      hysteresis: 1.15, rearmMs: 120,
      dwell: 'oneshot', start: 'top', release: 'play-to-end',
    });
    let t = armTrigger(sid);
    out.armed = !!t && t.particles.length === 50;
    // Region end tracks the LAST PARTICLE's position plus one spacing — not
    // its grainDuration, which is the granular grain length and would overshoot
    // to the end of the buffer. This is what made erasing the tail inaudible.
    out.regionEnd = t.loopEnd;
    out.regionEndSane = t.loopEnd < 49 * 0.05 + 0.5;
    // Particles must be the LIVE objects, not copies — this is the property
    // erase/undo/delete-all all depend on.
    out.sharesParticles = !!t && t.particles[0] === S.particles.find(p => p.strokeId === sid);
    // Start the synthetic clock ABOVE the wall clock. armTrigger seeds
    // trigger._lastFireAt from performance.now() (js/trigger.js:424), and the
    // rearm guard at :813 compares it against whatever timestamp the gate is
    // handed — so a synthetic clock starting at 0 is permanently "too soon"
    // until it accumulates past however long the app took to boot. Under
    // playwright that was a fast, fixed boot and the two happened to line up;
    // in Electron it does not, which is why this ordering is now explicit
    // rather than accidental.
    let now = performance.now() + 1e6;
    const step = (lon, ms) => { now += ms; S._updateTriggerGates(lon, 0, now); };

    // A freshly recorded trigger PLAYS ONCE on the next tick — the cursor is
    // still on the stroke it just painted, and hearing it back is the
    // confirmation that it landed.
    out.startsOutside = !!t && t.trigger._inside === false;
    step(0.10, 20);                         // cursor still on the stroke
    out.firesOnRecord = t.playing === true;
    out.auditionFromTop = t.startOffset === 0;
    t.playing = false;
    step(0.10, 20);                         // still there — no second edge
    out.doesNotRepeat = t.playing === false;

    // The audition must ignore start:'touch'. On release the cursor sits at the
    // END of the stroke just painted, so honouring 'touch' would start at the
    // last particle and play one median spacing — which reads as not playing at
    // all. Run the whole arm→fire sequence again under 'touch'.
    {
      const prevStart = S.triggerParams.start;
      S.triggerParams.start = 'touch';
      S.particles.length = 0;
      S.triggers.length = 0;
      const aud = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
      const at = armTrigger(aud);
      // Cursor parked at the far (high-lon) end, as it would be after painting.
      step(0.05, 1000);
      out.touchAuditionFired   = at.playing === true;
      out.touchAuditionFromTop = at.startOffset === 0;
      // ...and the NEXT hit obeys 'touch' again, starting mid-buffer.
      at.playing = false;
      step(0.40, 2000);
      step(0.05, 2000);
      out.touchNextHitObeysTouch = at.playing === true && at.startOffset > 0;
      S.triggerParams.start = prevStart;
      S.particles.length = 0;
      S.triggers.length = 0;
      // Rebuild the trigger the rest of the section works against.
      const sid2 = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
      t = armTrigger(sid2);
      t.trigger._audition = false;   // past the audition for the gate checks
      step(0.90, 3000);
    }

    step(0.40, 5000);                       // leave — rearm window expires too
    out.exitsOnLeave = t.trigger._inside === false && t.playing === false;
    step(0.15, 1000);                       // 5.7° from the near edge → inside
    out.enters = t.trigger._inside === true && t.playing === true;
    out.startedAtTop = t.startOffset === 0;
    step(0.20, 1000);                       // 8.6° — past enter, inside exit
    out.holdsInBand = t.trigger._inside === true;
    step(0.26, 1000);                       // 12.0° — beyond exit
    out.exits = t.trigger._inside === false;
    step(0.20, 1000);                       // same band, approached from outside
    out.bandDoesNotEnter = t.trigger._inside === false;

    // Rearm
    step(0.40, 1000); t.playing = false;
    step(0.15, 1000);
    const fired = t.playing === true;
    step(0.40, 10); t.playing = false;
    step(0.15, 10);                          // 20 ms later — inside rearm 120
    out.rearmSuppresses = fired && t.playing === false;
    step(0.40, 10); step(0.15, 500);
    out.rearmReleases = t.playing === true;

    // THE CAP IS NOT A MUTE (2026-09-23): a take already sounding plays on
    // when the cap comes down, and the gate keeps tracking while capped so
    // uncapping doesn't bang whatever the cursor is on — the ENTER edge alone
    // is suppressed. (Until tonight the cap silenced every sounding trigger.)
    const M = await import('./js/ui-meters.js');
    M.setScanMuted(true);
    out.muteKeepsPlaying = t.playing === true;
    t.playing = false; t._startedAt = 0;      // the pass ends on its own; no 'ended' under a quiesced scheduler
    step(0.40, 1000); step(0.15, 1000);
    out.mutedDoesNotFire = t.playing === false;
    out.mutedStillTracks = t.trigger._inside === true;
    M.setScanMuted(false);
    step(0.15, 1000);                        // still inside — no new edge
    out.unmuteDoesNotBang = t.playing === false;
    step(0.40, 1000); step(0.15, 1000);
    out.firesAfterUnmute = t.playing === true;

    // ── D2. Read-time vs baked (#236/#240) ───────────────────────────────
    // The lens's "on loops" family (dwell, start, retrig, rearm, hysteresis)
    // is read live and never copied into a trigger. Speed and volume are the
    // BAKED half: stamped from the dials when the stroke was drawn, deaf to
    // the panel afterwards — moving the speed dial changes the NEXT
    // recording, never what is already on the sphere.
    out.noBakedSettings = t.trigger.dwell === undefined
                       && t.trigger.rearmMs === undefined
                       && t.trigger.hysteresis === undefined;
    out.speedStamped = t.speed === S.triggerParams.speed;

    // ── D2c. Off-cursor claim (#241) ─────────────────────────────────────
    // A stroke claimed by a live loop slot is in a layer — off cursor — and
    // the lens must not fire it: no accidental re-trigger of a looping
    // stroke. Release the claim and the leave-and-come-back rule applies.
    {
      step(0.90, 3000);                      // safely outside
      t.playing = false; t._startedAt = 0;   // scheduler is quiesced — no 'ended' will clear it
      const slot = { type: 'loop', strokeId: t.strokeId, playing: true, particles: [1] };
      S.commitSlots[0] = slot;
      step(0.15, 3000);                      // enter — claimed, must not fire
      out.claimedNoFire = t.playing === false && t.trigger._inside === true;
      step(0.90, 3000);                      // leave
      S.commitSlots[0] = null;               // claim released
      step(0.15, 3000);                      // re-enter — scratch again
      out.firesAfterClaimGone = t.playing === true;
      step(0.90, 3000);
    }

    // Reach is live and comes from the search radius: widen that and a cursor
    // that was outside is now inside.
    step(0.40, 2000);                        // safely outside at 8°
    const wasOutside = t.trigger._inside === false;
    S.searchRadiusDeg = 30;
    step(0.40, 1000);
    out.radiusIsLive = wasOutside && t.trigger._inside === true;
    S.searchRadiusDeg = 8;
    step(0.90, 1000);                        // far enough out at either radius

    // Dwell reaches a sounding trigger (read-time); speed and volume do NOT
    // (baked). A fake source stands in for the node the seq block would have
    // built — headless has no running AudioContext.
    step(0.15, 2000);                        // fire it
    const firedForLive = t.playing === true;
    let rateSet = null, gainSet = null;
    t._sourceNode = { _stopped: false, loop: false,
                      playbackRate: { setTargetAtTime: v => { rateSet = v; } } };
    t._gainNode   = { gain: { setTargetAtTime: v => { gainSet = v; } } };
    const stampedSpeed = t.speed, stampedVol = t.grainParams.volume;
    S.triggerParams.speed  = 2.0;
    S.triggerParams.volume = 0.25;
    S.triggerParams.dwell  = 'loop';
    step(0.15, 20);                          // still inside — no new edge
    out.liveDwellApplied  = t._sourceNode.loop === true;
    out.bakedSpeedDeaf    = rateSet === null && t.speed === stampedSpeed;
    out.bakedVolDeaf      = gainSet === null && t.grainParams.volume === stampedVol;
    out.firedForLive = firedForLive;
    t._sourceNode = null; t._gainNode = null;
    Object.assign(S.triggerParams, { speed: 1.0, volume: 1.0, dwell: 'oneshot' });

    // ── D2b. retrig — what a refire does to a pass already sounding ──────
    {
      const prev = S.triggerParams.retrig;
      S.particles.length = 0;
      S.triggers.length = 0;
      const rsid = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
      const rt = armTrigger(rsid);
      rt.trigger._audition = false;
      step(0.40, 3000);

      // Fake a sounding source so a refire has something to act on.
      const mkSrc = () => ({ _stopped: false, loop: false, stop() { this._stopped = true; },
                             addEventListener() {}, playbackRate: { setTargetAtTime() {} } });
      const mkGain = () => ({ gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {},
                                      linearRampToValueAtTime() {}, setTargetAtTime() {} } });

      // cut: the old source is stopped and nothing is stacked.
      S.triggerParams.retrig = 'cut';
      step(0.10, 2000);                       // fire
      rt._sourceNode = mkSrc(); rt._gainNode = mkGain();
      const cutSrc = rt._sourceNode;
      step(0.40, 2000); step(0.10, 2000);     // leave and refire
      out.cutStopsOld    = cutSrc._stopped === true;
      out.cutStacksNone  = !rt._voices || rt._voices.length === 0;

      // layer: the old source is left running and kept as a voice.
      S.triggerParams.retrig = 'layer';
      rt._sourceNode = mkSrc(); rt._gainNode = mkGain();
      // …and its whole chain: own, mute and pin gains are the voice's too
      // (2026-09-22 night — left on the trigger, the rebuild's releaseSeqNodes
      // disconnected them and the old voice went silent: layer sounded as cut).
      const own = { disconnect() {} }, mute = { disconnect() {} }, pin = { disconnect() {} };
      rt._ownGain = own; rt._muteGain = mute; rt._pinGain = pin;
      rt._startedAt = 1;                      // a started voice, so it carries a tail
      const layerSrc = rt._sourceNode;
      step(0.40, 2000); step(0.10, 2000);     // leave and refire
      out.layerKeepsOldRinging = layerSrc._stopped === false;
      out.layerStacksVoice     = (rt._voices?.length ?? 0) === 1;
      out.layerClearsCurrent   = rt._sourceNode === null;   // seq block builds a fresh one
      out.layerTakesChain      = rt._ownGain === null && rt._muteGain === null && rt._pinGain === null
                                 && [own, mute, pin].every(n => rt._voices?.[0]?.extras?.includes(n));
      // …and its playhead: a tail record the renderer draws a square from (2026-09-23).
      out.layerVoiceHasTail    = !!rt._voices?.[0]?.tail && rt._voices[0].tail.loopEnd === rt.loopEnd;

      // A detached voice ending must NOT clear `playing` on its replacement.
      rt._sourceNode = mkSrc();
      rt.playing = true;
      S._onTriggerSourceEnded(rt, layerSrc);  // the OLD voice finishes
      out.staleEndIgnored = rt.playing === true;
      S._onTriggerSourceEnded(rt, rt._sourceNode);  // the current one finishes
      out.currentEndClears = rt.playing === false;

      // Silencing a trigger takes its stacked voices with it.
      rt._sourceNode = null; rt._gainNode = null;
      S._stopTriggerAudio(rt, 'fade');
      out.stopClearsVoices = (rt._voices?.length ?? 0) === 0;

      S.triggerParams.retrig = prev;
      S.particles.length = 0;
      S.triggers.length = 0;
      const sid4 = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
      t = armTrigger(sid4);
      t.trigger._audition = false;
      step(0.90, 3000);
    }

    // ── D3. start:'ends' — direction follows the end you arrive at ───────
    // The mode that exists because `touch` degenerates on a turntable, which
    // only ever arrives at one end or the other.
    {
      const prev = S.triggerParams.start;
      S.triggerParams.start = 'ends';
      S.particles.length = 0;
      S.triggers.length = 0;
      const esid = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
      const et = armTrigger(esid);
      et.trigger._audition = false;            // audition is always top/forward
      step(0.40, 3000);                        // park well clear

      // Arrive at the FRONT (low lon = early buffer time) → forwards from top.
      step(-0.15, 2000);
      out.endsFrontFired   = et.playing === true;
      out.endsFrontForward = et.direction === 1 && et.startOffset === 0;

      // Arrive at the TAIL → backwards, from the very end, still offset 0
      // (offset 0 in the reversed copy IS the region's end).
      et.playing = false;
      step(0.40, 2000);
      step(0.15, 2000);
      out.endsBackFired   = et.playing === true;
      out.endsBackReverse = et.direction === -1 && et.startOffset === 0;
      out.endsBackPlayhead = et.playheadIndex === et.particles.length - 1;

      S.triggerParams.start = prev;
      S.particles.length = 0;
      S.triggers.length = 0;
      const sid3 = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 50 });
      t = armTrigger(sid3);
      t.trigger._audition = false;
      step(0.90, 3000);
    }

    // ── D. Material lifecycle ────────────────────────────────────────────
    // Erasing the tail trims the sample: the region shortens, the trigger lives.
    // Read the stroke off the trigger under test, not the `sid` from section C —
    // every block above ends by clearing S.particles and repainting, so that
    // name has pointed at erased material since D3 was added.
    const dsid = t.strokeId;
    const regionBefore = t.loopEnd;
    const keep = S.particles.filter(p => !(p.strokeId === dsid && p.grainStart > 1.0));
    S.particles = keep;
    S._particleVersion++;
    step(0.40, 2000);                        // any tick refreshes
    out.eraseTrimsRegion = S.triggers.length === 1 && t.loopEnd < regionBefore;
    out.eraseKeepsTrigger = S.triggers.length === 1;

    // Erasing all of it removes the trigger — no disarm needed.
    S.particles = S.particles.filter(p => p.strokeId !== dsid);
    S._particleVersion++;
    step(0.40, 1000);
    out.eraseAllRemovesTrigger = S.triggers.length === 0;

    // (A GAP CHOP was tested here — `triggerParams.chop` / `chopOn`, a take cut
    // at its silences. It became SLICE on 2026-09-22, cut at its ATTACKS against
    // the room's floor (`sliceOn`), and the gap mechanism went; slice is proven
    // in § slice below. Removed 2026-09-23, at the 5.6 release sweep.)

    // A take with PAUSES in it must stay ONE trigger. The paint ticker deposits
    // nothing while the input sits under the noise gate, so a 20 s phrase with
    // rests, breaths or decays arrives with big gaps already in it — and those
    // gaps are material, not edits. Splitting on gap size read them as holes and
    // chopped a single take into ~8 triggers.
    S.particles.length = 0;
    S.triggers.length = 0;
    {
      const psid = ++nextStroke;
      let tt = 0;
      for (let i = 0; i < 60; i++) {
        // Four bursts of 15, separated by ~1 s of silence — ordinary phrasing.
        if (i > 0 && i % 15 === 0) tt += 1.0;
        else if (i > 0) tt += 0.05;
        const p = { lon: -0.05 + (i / 59) * 0.1, lat: 0, strokeId: psid,
                    source: 'live', liveBufferIdx: 0, grainStart: tt, grainDuration: 2.0, trig: true };
        grain.stampCartesian(p);
        S.particles.push(p);
      }
      S._particleVersion++;
      armTrigger(psid);
      out.pausedTakeArmsAsOne = S.triggers.length === 1;
      // ...and stays one across rebuilds, with no erase to justify a split.
      S._particleVersion++;
      step(0.40, 2000);
      out.pausedTakeStaysOne = S.triggers.length === 1;
      // The region must span the pauses, not stop at the first burst. One burst
      // is 15 x 0.05 = 0.7 s; the fixture buffer is 3 s, so the region clamps
      // there — anything past ~2 s proves it covers multiple bursts and the
      // silence between them.
      const pt = S.triggers[0];
      out.pausedTakeSpansAll = !!pt && (pt.loopEnd - pt.loopStart) > 2.0;
    }

    // Erasing a HOLE in the middle splits the trigger in two — it is now two
    // sounds, and one region spanning the hole would play back silence the
    // performer deliberately removed.
    S.particles.length = 0;
    S.triggers.length = 0;
    const splitSid = paintStroke({ trig: true, centreLon: 0, span: 0.05, n: 40 });
    armTrigger(splitSid);
    const beforeSplit = S.triggers.length;
    // Bite out the middle third by buffer time (particles are 0.05 s apart, so
    // this leaves a ~0.5 s hole — well past both split thresholds).
    S.particles = S.particles.filter(p =>
      !(p.strokeId === splitSid && p.grainStart > 0.7 && p.grainStart < 1.2));
    S._particleVersion++;
    step(0.40, 2000);
    out.splitCount = S.triggers.length;
    out.splitFromOne = beforeSplit === 1;
    // The halves must be genuinely separate strokes, or the next rebuild would
    // re-collect both and split forever.
    out.splitDistinctStrokes = S.triggers.length === 2
      && S.triggers[0].strokeId !== S.triggers[1].strokeId;
    // Each half covers its own side of the hole, and neither spans it.
    const [a, b] = S.triggers;
    out.splitRegionsDisjoint = !!a && !!b && (a.loopEnd <= b.loopStart || b.loopEnd <= a.loopStart);
    // Stable: rebuilding again must not split further.
    S._particleVersion++;
    step(0.40, 1000);
    out.splitStable = S.triggers.length === 2;
    // ...and neither half fires itself just for having been created.
    out.splitSilent = S.triggers.every(x => x.playing === false);

    // Bounding cap: a far trigger never reaches the per-particle scan, which is
    // the only thing that writes _nearestDot.
    S.particles.length = 0;
    S.triggers.length = 0;
    const farSid = paintStroke({ trig: true, centreLon: Math.PI });
    const far = armTrigger(farSid);
    far._nearestDot = -1;
    step(0, 2000);
    out.capRejects = far._nearestDot === -1;

    S.particles.length = 0;
    S.triggers.length = 0;
    S._postWorkletCandidates = null;
    return out;
  });

  console.log('\n§ typing — never both');
  check('granular stroke reaches the radius pool', r.radiusPoolHasGranular);
  check('trigger stroke is excluded from the radius pool', r.radiusPoolHasTrigger === false);
  check('granular stroke reaches the nearest-mode pool', r.nearestPoolHasGranular);
  check('trigger stroke is excluded from the nearest-mode pool', r.nearestPoolHasTrigger === false);
  check("dwell:'grain' does NOT open on arrival — the take plays first", r.grainDwellArrivalShut);
  check("dwell:'grain' opens trigger material to the radius pool once the take has played", r.grainDwellRadiusOpens);
  check("dwell:'grain' opens it to the nearest-mode pool too", r.grainDwellNearestOpens);
  check("...but nearest mode still requires proximity (it has no radius of its own)",
    r.grainDwellNearestStillBounded);
  check('leaving grain dwell closes it again', r.grainDwellClosesAgain);
  check('a dwelling trigger reads with the LIVE grain block, not the voicing its hit brush froze', r.dwellReadsLive === true, `${r.dwellRows} trigger rows of ${r.dwellAllRows} ${JSON.stringify(r.dwellDiag)}`);

  console.log('\n§ gate');
  check('trigger armed from a painted stroke', r.armed);
  check('region end follows the last particle, not its grain length',
    r.regionEndSane, `loopEnd=${r.regionEnd}`);
  check('trigger shares live particles, does not copy them', r.sharesParticles);
  check('a freshly recorded trigger starts outside', r.startsOutside);
  check('...and plays once on release, where the cursor already is', r.firesOnRecord);
  check('...but does not repeat while the cursor stays on it', r.doesNotRepeat);
  check('the audition plays from the top', r.auditionFromTop);
  check("audition ignores start:'touch' (cursor is at the stroke's end on release)",
    r.touchAuditionFired && r.touchAuditionFromTop,
    `fired=${r.touchAuditionFired} fromTop=${r.touchAuditionFromTop}`);
  check("...and the next hit obeys start:'touch' again", r.touchNextHitObeysTouch);
  check('leaves when the cursor moves away', r.exitsOnLeave);
  check('enters within the radius and fires', r.enters);
  check("start:'top' begins at the region origin", r.startedAtTop);
  check('holds through the hysteresis band on the way out', r.holdsInBand);
  check('does not enter in the hysteresis band on the way in', r.bandDoesNotEnter);
  check('exits beyond the exit radius', r.exits);
  check('rearm window suppresses a too-soon refire', r.rearmSuppresses);
  check('fires again once the rearm window passes', r.rearmReleases);
  check('bounding cap rejects a far trigger before the scan', r.capRejects);

  // The cap is the cursor's ONE mute since 2026-09-07. A hit plays through the
  // loop commit engine, not the cursor bus `setScanMuted` gates, so every line
  // here is proof the silencing is really wired rather than a gain that was
  // never in a hit's path — which is exactly how hits went on sounding under
  // the cap for as long as they did.
  console.log('\n§ the cap silences hits too, not just granulation');
  check('the cap is not a mute: a sounding trigger plays on when it comes down', r.muteKeepsPlaying);
  check('a capped lens fires no hits', r.mutedDoesNotFire);
  check('the gate keeps tracking position while capped', r.mutedStillTracks);
  check('uncapping on top of a trigger does not bang it', r.unmuteDoesNotBang);
  check('fires normally after uncapping once re-entered', r.firesAfterUnmute);

  console.log('\n§ read-time vs baked (#236/#240)');
  check('the on-loops family is never copied into a trigger', r.noBakedSettings);
  check('speed is stamped at arm time', r.speedStamped);
  check('a loop-claimed stroke never fires on touch (#241)', r.claimedNoFire);
  check('releasing the claim makes it scratch again', r.firesAfterClaimGone);
  check('radius change takes effect immediately', r.radiusIsLive);
  check('trigger fired for the live-param checks', r.firedForLive);
  check('dwell change flips a sounding one-shot to looping', r.liveDwellApplied);
  check('a speed move is deaf to what is already on the sphere', r.bakedSpeedDeaf);
  check('a volume move is deaf to what is already on the sphere', r.bakedVolDeaf);

  console.log('\n§ retrig — cut vs layer');
  check("cut: the pass already sounding is stopped", r.cutStopsOld);
  check('cut: nothing is stacked', r.cutStacksNone);
  check('layer: the old pass is left ringing', r.layerKeepsOldRinging);
  check('layer: it is kept as a stacked voice', r.layerStacksVoice);
  check('layer: the trigger is left sourceless so a fresh voice is built', r.layerClearsCurrent);
  check('layer: the old voice takes its own, mute and pin gains with it — the rebuild cannot cut it', r.layerTakesChain);
  check('layer: the old voice carries a tail record, so the viz draws its playhead', r.layerVoiceHasTail);
  check('a detached voice ending does not clear playing on its replacement', r.staleEndIgnored);
  check('...but the current source ending does', r.currentEndClears);
  check('silencing a trigger stops its stacked voices too', r.stopClearsVoices);

  console.log("\n§ start:'ends' — direction follows the end you arrive at");
  check('arriving at the front fires it', r.endsFrontFired);
  check('...forwards from the top', r.endsFrontForward);
  check('arriving at the tail fires it', r.endsBackFired);
  check('...backwards from the very end, in full', r.endsBackReverse);
  check('...with the playhead starting at the last particle', r.endsBackPlayhead);

  console.log('\n§ material lifecycle');
  check('erasing the tail trims the sample region', r.eraseTrimsRegion);
  check('partial erase keeps the trigger', r.eraseKeepsTrigger);
  check('erasing all of it removes the trigger', r.eraseAllRemovesTrigger);
  check('with slice off, a take with pauses arms as ONE trigger', r.pausedTakeArmsAsOne);
  check('...and stays one across rebuilds', r.pausedTakeStaysOne);
  check('...with the region spanning the pauses', r.pausedTakeSpansAll);
  check('erasing the middle splits one trigger into two',
    r.splitFromOne && r.splitCount === 2, `was ${r.splitCount}`);
  check('the halves are separate strokes (so they never re-split)', r.splitDistinctStrokes);
  check('the halves cover disjoint regions — neither spans the hole', r.splitRegionsDisjoint);
  check('splitting is stable under a further rebuild', r.splitStable);
  check('neither half fires itself on being created', r.splitSilent);

  // ── E. Cost ───────────────────────────────────────────────────────────────
  console.log('\n§ cost (gate only, per tick — budget is the 20 ms scheduler interval)');
  const cost = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const grain = await import('./js/grain.js');
    const { armTrigger } = await import('./js/trigger.js');
    const TK = await import('./js/take.js');
    S.liveRecBuffers = [{ buffer: TK.makeTake(new Float32Array(44100 * 8), 44100), liveBuffer: null, grainCursor: 0 }];
    let nextStroke = 5000;
    function fill(n, each) {
      S.particles.length = 0;
      S.triggers.length = 0;
      for (let i = 0; i < n; i++) {
        const sid = ++nextStroke;
        const centre = (i / Math.max(1, n)) * Math.PI * 2;
        for (let k = 0; k < each; k++) {
          const p = { lon: centre + (k / each) * 0.1, lat: 0, strokeId: sid,
                      source: 'live', liveBufferIdx: 0, grainStart: k * 0.01, grainDuration: 0.01, trig: true };
          grain.stampCartesian(p);
          S.particles.push(p);
        }
        S._particleVersion++;
        armTrigger(sid);
      }
    }
    function time(iters) {
      let now = performance.now() + 1e6;   // see the clock note in section C
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) {
        now += 20;
        S._updateTriggerGates((i / iters) * Math.PI * 2, 0, now);
      }
      return (performance.now() - t0) / iters;
    }
    const outc = {};
    for (const n of [0, 1, 8, 32, 64, 256]) { fill(n, 200); time(200); outc[n] = +time(2000).toFixed(5); }
    // NO CEILING (Ek, 2026-09-23: "there should be no limit"): 200 strokes of
    // 3 marks, one at a time, all armed. (32, then a rolling 64, until tonight.)
    S.particles.length = 0; S.triggers.length = 0;
    const sids = [];
    for (let i = 0; i < 200; i++) {
      const sid = ++nextStroke; sids.push(sid);
      for (let k = 0; k < 3; k++) { const p = { lon: (i / 200) * Math.PI * 2 + k * 0.02, lat: 0.3, strokeId: sid, source: 'live', liveBufferIdx: 0, grainStart: k * 0.01, grainDuration: 0.01, trig: true }; grain.stampCartesian(p); S.particles.push(p); }
      S._particleVersion++;
      armTrigger(sid);
    }
    const have = new Set(S.triggers.map(t => t.strokeId));
    outc.pool = { n: S.triggers.length, allKept: sids.every(s => have.has(s)) };
    S.particles.length = 0;
    S.triggers.length = 0;
    return outc;
  });

  for (const n of [0, 1, 8, 32, 64, 256]) console.log(`  ${String(n).padStart(3)} triggers × 200 particles: ${cost[n]} ms/tick`);
  check('32 triggers cost under 1 ms per tick', cost[32] < 1.0, `${cost[32]} ms`);
  check('256 triggers cost under 2 ms per tick — there is no ceiling, and this is why there need not be', cost[256] < 2.0, `${cost[256]} ms`);
  check('no ceiling: 200 strokes armed, 200 gates, every one kept',
    cost.pool && cost.pool.n === 200 && cost.pool.allKept, JSON.stringify(cost.pool));
  check('cost scales sub-linearly (cap is working)', cost[32] < cost[1] * 32 || cost[1] < 0.002,
    `1:${cost[1]} 32:${cost[32]}`);
  // ── § slice — onset segmentation (#219) ──────────────────────────────────
  // The slice tool cuts a take into triggers at ONSETS detected on the audio
  // (js/onsets.js), floor-adaptively — not at gaps between marks, which was
  // the old chop's failure (it inherited the paint-gate threshold). Three
  // properties defended here: attacks are found across wildly different noise
  // floors, a swell never oversegments, and the pre-roll before the first
  // attack arms nothing. Full tuning matrix lived in the #219 bench harness;
  // this is the regression core.
  console.log('\n§ the button, not the marks — a loop\'s edges, the gate, the first pass, latency (2026-09-04)');
  const bt = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const A = await import('./js/audio.js');
    const UP = await import('./js/ui-presets.js');
    const LT = await import('./js/latency.js');
    const actx = A.ensureAudioContext();
    const sr = actx.sampleRate;
    const out = {};
    // (a) the estimate is arithmetic on what the streams report
    const est = LT.estimateFrom({ inStreamFrames: 480, inBufferFrames: 1024, outStreamFrames: 960, outBufferFrames: 1024, rate: 48000 });
    out.est = { inMs: +(est.inS * 1000).toFixed(3), outMs: +(est.outS * 1000).toFixed(3) };
    // (b) the click finder: six clicks a known 27.3 ms late → 27.3 ms; none → null
    const mkClicks = (delayS) => { const d = new Float32Array(sr * 3); if (delayS == null) return d;
      for (let k = 0; k < 6; k++) { const at = Math.round((0.4 + k * 0.3 + delayS) * sr); for (let i = 0; i < 144; i++) d[at + i] = 0.8; } return d; };
    const expected = [0, 1, 2, 3, 4, 5].map(k => 0.4 + k * 0.3);
    out.clicks = { found: +((LT.findClickDelayS(mkClicks(0.0273), sr, expected) ?? -1) * 1000).toFixed(2), none: LT.findClickDelayS(mkClicks(null), sr, expected) };

    const keep = { lat: S.latency, gate: S.paintGateThreshold, loopOnEnd: S.triggerParams.loopOnEnd, fx: S.brushFx, slots: S.commitSlots.slice(),
                   parts: S.particles.slice(), bufs: S.liveRecBuffers.slice(), hist: S.strokeHistory.slice(), trig: (S.triggers || []).slice() };
    if (!S.inputGainNode) S.inputGainNode = actx.createGain();
    if (!S.inputAnalyser) { S.inputAnalyser = actx.createAnalyser(); S.inputAnalyser.fftSize = 256; S.inputGainNode.connect(S.inputAnalyser); }
    const osc = actx.createOscillator(); const og = actx.createGain(); og.gain.value = 0.2; osc.connect(og); og.connect(S.inputGainNode); osc.start();
    window._rtAudioInputListening = true;
    try {
      S.commitSlots = new Array(keep.slots.length).fill(null);
      S.particles.length = 0; S.triggers = []; S.strokeHistory = []; S.brushFx = 'none';
      S.latency = { inS: 0.03, outS: 0.02, roundTripS: 0.05, source: 'measured', detail: 'test' };
      // (c) hit material is never gated: with the gate above everything, a hit
      //     take still paints; a grain take does not
      S.paintGateThreshold = 10;   // above any loudness the hold can report — a howl through the room clips past 1
      const recordHit = async (ms, { hit = true } = {}) => {
        if (hit) await S._startTriggerRecord(); else { A.startLiveRecording(); S.currentStrokeId = ++S.strokeIdCounter; S.strokeHistory.push({ strokeId: S.currentStrokeId, type: 'live', liveBufferIndex: S.currentLiveBufferIdx }); S.isPainting = true; }
        const sid = S.currentStrokeId, idx = S.currentLiveBufferIdx;
        await new Promise(r => setTimeout(r, ms));
        const marksBefore = S.particles.filter(p => p.strokeId === sid).length;
        const releaseNow = actx.currentTime;
        if (hit) S._stopTriggerRecord(); else { S.isPainting = false; S.currentStrokeId = -1; A.stopLiveRecording(); }
        const heldOpen = S.isRecording;
        await new Promise(res => A.whenSealed(res));
        await new Promise(r => setTimeout(r, 120));
        return { sid, slot: S.liveRecBuffers[idx], marks: S.particles.filter(p => p.strokeId === sid).length, marksBefore, releaseNow, heldOpen };
      };
      const grainTake = await recordHit(400, { hit: false });
      out.gate = { grainMarks: grainTake.marks };
      // (d) a hit take: marks despite the gate; the release stamped; the
      //     recorder held open by `inS`; edges = [inS, end]; the trigger's
      //     region is the edges, not the marks
      S.paintGateThreshold = 10;
      const hitTake = await recordHit(700);
      const sl = hitTake.slot;
      const t = (S.triggers || []).find(x => x.strokeId === hitTake.sid);
      out.gate.hitMarks = hitTake.marks;
      out.take = { heldOpen: hitTake.heldOpen, releaseStamped: sl?.releaseAt != null && Math.abs(sl.releaseAt - hitTake.releaseNow) < 0.02,
        durMinusHold: sl?.buffer ? +(sl.buffer.duration - (sl.releaseAt - sl.startedAt)).toFixed(3) : null,
        edges: sl?.edges ? { s: +sl.edges.startS.toFixed(3), e: +sl.edges.endS.toFixed(3), dur: +sl.buffer.duration.toFixed(3) } : null,
        span: sl?.markSpan ? sl.markSpan.map(v => +v.toFixed(3)) : null };
      out.region = t ? { lo: +t.loopStart.toFixed(3), hi: +t.loopEnd.toFixed(3), fromEdges: sl?.edges && t.loopStart === sl.edges.startS && t.loopEnd === sl.edges.endS,
        marks: t.particles.map(p => +p.grainStart.toFixed(3)), all: S.particles.filter(p => p.strokeId === hitTake.sid).map(p => +p.grainStart.toFixed(3)) } : null;
      // (d2) erase trims: drop the last mark, rebuild → the marks rule again
      const ps = S.particles.filter(p => p.strokeId === hitTake.sid).sort((a, b) => a.grainStart - b.grainStart);
      const last = ps[ps.length - 1];
      S.particles = S.particles.filter(p => p !== last); S._particleVersion++;
      S._refreshTriggers();
      out.trimmed = t ? { hi: +t.loopEnd.toFixed(3), back: t.loopEnd < sl.edges.endS - 0.02 } : null;
      // (e) the looper: the first pass starts on the release
      S.paintGateThreshold = 0;
      S.triggerParams.loopOnEnd = true;
      const lp = await recordHit(600);
      await new Promise(r => setTimeout(r, 200));            // the looper's 60 ms + the seal
      const seq = S.commitSlots.find(c => c && c.type === 'loop' && c.strokeId === lp.sid);
      out.loop = { made: !!seq, anchor: seq?._phaseAnchor != null && Math.abs(seq._phaseAnchor - lp.slot.releaseAt) < 1e-6 };
      if (seq) {
        seq.playing = true;
        G.scheduleGrains();                                   // builds the source, applies the anchor
        const now = actx.currentTime;
        const ll = seq.loopEnd - seq.loopStart;
        const want = (((now - lp.slot.releaseAt) % ll) + ll) % ll;
        const got = G.masterPhaseWall(seq, now);
        out.loop.phaseErrMs = +((got - want) * 1000).toFixed(1);
        out.loop.regionFromEdges = seq.loopStart === 0 && Math.abs(seq.loopEnd - (lp.slot.edges.endS - lp.slot.edges.startS)) < 1e-6;
        UP.removeSeq(seq.slotIndex, true);
      }
      // (f) the measurement end to end: the clicks through a 27 ms software
      //     loopback into the recorder read as 27 ms, and are stored
      {
        og.gain.value = 0;   // the test's oscillator is the room: silent for the measurement
        await new Promise(r => setTimeout(r, 60));
        const tap = actx.createDelay(1.0); tap.delayTime.value = 0.027; tap.connect(S.inputGainNode);
        S._calibrationTap = tap;
        const keyBefore = localStorage.getItem('mubone_latency_cal');
        const d = await LT.measureRoundTrip();
        S._calibrationTap = null; try { tap.disconnect(); } catch (_) {}
        og.gain.value = 0.2;
        out.measure = { ms: d != null ? +(d * 1000).toFixed(2) : null, evidence: S._latencyLast, source: S.latency?.source, rt: +((S.latency?.roundTripS ?? 0) * 1000).toFixed(2) };
        // Stored as the devices' share: move the cushion and the round trip
        // follows by two cushions, with no second measurement.
        // The default is 10 ms since R1 (2026-09-06), so the move is 10 → 20:
        // the round trip must rise by two cushions, and fall back.
        if (window.electronBridge && S._setAudioCushion) {
          const c0 = S.audioCushionMs; const c1 = c0 === 20 ? 10 : 20;
          S._setAudioCushion(c1); await LT.refreshLatency();
          out.measure.rtMoved = +((S.latency?.roundTripS ?? 0) * 1000).toFixed(2); out.measure.srcMoved = S.latency?.source;
          out.measure.movedBy = (c1 - c0) * 2;
          S._setAudioCushion(c0); await LT.refreshLatency();
          out.measure.rtBack = +((S.latency?.roundTripS ?? 0) * 1000).toFixed(2);
        }
        if (keyBefore == null) localStorage.removeItem('mubone_latency_cal'); else localStorage.setItem('mubone_latency_cal', keyBefore);
        await LT.refreshLatency();
      }
      // (g) a press inside the hold cuts it: the old take seals, the new one starts
      S.triggerParams.loopOnEnd = false;
      await S._startTriggerRecord(); const sidA = S.currentStrokeId; const idxA = S.currentLiveBufferIdx;
      await new Promise(r => setTimeout(r, 300));
      S._stopTriggerRecord();                                  // held open 30 ms …
      const heldA = S.isRecording;
      await S._startTriggerRecord();                           // … and pressed again at once
      const sidB = S.currentStrokeId, idxB = S.currentLiveBufferIdx;
      await new Promise(r => setTimeout(r, 300));
      S._stopTriggerRecord();
      await new Promise(res => A.whenSealed(res));
      await new Promise(r => setTimeout(r, 150));
      out.cut = { heldA, twoTakes: idxB === idxA + 1 && !!S.liveRecBuffers[idxA]?.buffer && !!S.liveRecBuffers[idxB]?.buffer, distinct: sidB !== sidA,
                  aDur: +(S.liveRecBuffers[idxA]?.buffer?.duration ?? 0).toFixed(3) };
    } finally {
      osc.stop();
      for (const c of S.commitSlots) if (c?.type === 'loop') G.releaseSeqNodes(c);
      S.latency = keep.lat; S.paintGateThreshold = keep.gate; S.triggerParams.loopOnEnd = keep.loopOnEnd; S.brushFx = keep.fx;
      S.commitSlots = keep.slots; S.particles = keep.parts; S.liveRecBuffers = keep.bufs; S.strokeHistory = keep.hist; S.triggers = keep.trig;
      S._particleVersion++;
    }
    return out;
  });
  check('the estimate is device + cushion per side, plus the capture batch out: in 30.0 ms, out 61.3 ms', bt.est.inMs === 30 && bt.est.outMs === 61.333, JSON.stringify(bt.est));
  check('the click finder reads six clicks 27.3 ms late as 27.3 ms, and nothing as null', Math.abs(bt.clicks.found - 27.3) < 0.1 && bt.clicks.none === null, JSON.stringify(bt.clicks));
  check('hit material is never gated: a hit take paints under a gate that stops a grain take', bt.gate.hitMarks >= 8 && bt.gate.grainMarks === 0, JSON.stringify(bt.gate));
  check('the release is stamped and the recorder held open by the input latency', bt.take.releaseStamped && bt.take.heldOpen && bt.take.durMinusHold >= 0.025 && bt.take.durMinusHold <= 0.06, JSON.stringify(bt.take));
  check('the take\'s edges are [inS, end]', bt.take.edges && bt.take.edges.s === 0.03 && bt.take.edges.e === bt.take.edges.dur, JSON.stringify(bt.take));
  check('an untrimmed line\'s region IS the edges — the button, not the marks', bt.region && bt.region.fromEdges, JSON.stringify({ region: bt.region, take: bt.take }));
  check('erase the last mark and the marks rule again', bt.trimmed && bt.trimmed.back, JSON.stringify(bt.trimmed));
  check('the looper\'s loop carries the release as its phase anchor and its region from the edges', bt.loop.made && bt.loop.anchor && bt.loop.regionFromEdges, JSON.stringify(bt.loop));
  check('… and its first pass is phased to the release, within a scheduler tick', bt.loop.made && Math.abs(bt.loop.phaseErrMs) <= 25, JSON.stringify(bt.loop));
  check('a press inside the hold cuts it: two takes, both sealed', bt.cut.heldA && bt.cut.twoTakes && bt.cut.distinct && bt.cut.aDur >= 0.28, JSON.stringify(bt.cut));
  // A MAJORITY of the clicks, not all six — findClicks' own contract is that
  // it needs more than half and then takes the MEDIAN of what it found, which
  // is the whole point of sending six. Demanding 6 of 6 asserted a cleaner
  // room than the code requires: through a real device the run found 4, then
  // 5, then 6 on three consecutive full-suite runs and computed 27 ms every
  // time. The delay, its source and the stored round trip are the contract;
  // the click count is evidence, and the synthetic case above already proves
  // the finder reads all six off a clean buffer.
  const ev = bt.measure.evidence;
  check('the measurement end to end: a 27 ms loopback reads as 27 ms off a majority of six clicks, stored as measured', bt.measure.ms != null && Math.abs(bt.measure.ms - 27) < 1.5 && ev?.found > ev?.of / 2 && bt.measure.source === 'measured' && Math.abs(bt.measure.rt - bt.measure.ms) < 0.01, JSON.stringify(bt.measure));
  if (bt.measure.rtMoved != null) check('… kept as the devices\' share: moving the cushion moves the round trip by two cushions, still measured, and back', bt.measure.srcMoved === 'measured' && Math.abs((bt.measure.rtMoved - bt.measure.rt) - bt.measure.movedBy) < 0.2 && Math.abs(bt.measure.rtBack - bt.measure.rt) < 0.01, JSON.stringify(bt.measure));

  console.log('\n§ the hops are bounded — the stall cushion (2026-09-04, #333), and the GUI thread is not in them (2026-09-06)');
  const hp = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const A = await import('./js/audio.js');
    const out = { electron: !!window.electronBridge };
    if (!window.electronBridge) return out;
    const sr = S.audioCtx?.sampleRate ?? 48000, frames = S.preferredBufferSize ?? 1024, blockMs = frames / sr * 1000;
    const keep = S.audioCushionMs;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const read = () => ({ depth: +A.outputQueueDepthMs().toFixed(1), fill: +S.transportDiag.inFillMs.toFixed(1), skipped: S.transportDiag.inSkipped, dropped: S.transportDiag.outDropped, outDry: S.transportDiag.outDry, inDry: S.transportDiag.inDry });
    let rep = null;
    try { rep = await window.electronBridge.getStreamLatency(); } catch (_) {}
    out.streams = { out: rep?.outBufferFrames != null, in: rep?.inBufferFrames != null };
    try {
      S._setAudioCushion(20);
      await wait(800);
      out.dropped0 = S.transportDiag.outDropped; out.skipped0 = S.transportDiag.inSkipped;
      out.window = A.cushionBlocks();
      out.blockMs = +blockMs.toFixed(2); out.blockMsRaw = blockMs;
      await wait(1500);
      out.at20 = read();
      let depthMain = null;
      try { const d = await window.electronBridge.getOutputDepth(); depthMain = d.blockFrames ? +(d.frames / sr * 1000).toFixed(1) : null; } catch (_) {}
      out.at20.mainDepth = depthMain;
      // A stall: the GUI thread frozen for 80 ms — longer than the cushion.
      // Since 2026-09-06 the blocks and the chunks travel worklet ↔ main
      // process on their own ports, so this thread is not in the path: the
      // hops must not notice. Then 250 ms, a stall no cushion would absorb.
      const t0 = performance.now(); while (performance.now() - t0 < 80) { /* spin */ }
      await wait(1500);
      out.afterStall = read();
      const t1 = performance.now(); while (performance.now() - t1 < 250) { /* spin */ }
      await wait(1500);
      out.afterLongStall = read();
      S._setAudioCushion(10);
      await wait(1500);
      out.at10 = read();
      out.window10 = A.cushionBlocks();
    } finally { S._setAudioCushion([10, 20, 30, 50].includes(keep) ? keep : 20); }
    return out;
  });
  if (!hp.electron) console.log('  --   not Electron — no hops to bound');
  else {
    // the bound is the cushion plus the jitter margin (10 ms, or two blocks) plus a block in flight
    const margin = Math.max(2 * hp.blockMs, 10);
    const within = (r, ms) => hp.streams.out ? (r.depth <= ms + margin + hp.blockMs + 0.01) : true;
    check('the cushion in blocks is the depth main primes to', hp.window === Math.max(2, Math.round(20 / hp.blockMsRaw)) && hp.window10 === Math.max(2, Math.round(10 / hp.blockMsRaw)), JSON.stringify({ window: hp.window, window10: hp.window10, blockMs: hp.blockMs }));
    if (!hp.streams.out) console.log('  --   no output stream on this instance — the queue depth cannot be read');
    else check('the output queue is held at the cushion, never above it (20 ms), and the main process agrees', within(hp.at20, 20) && (hp.at20.mainDepth == null || Math.abs(hp.at20.mainDepth - hp.at20.depth) <= 4 * hp.blockMs + 0.01), JSON.stringify(hp.at20));
    if (!hp.streams.in) console.log('  --   no input stream on this instance — the ring fill cannot be read');
    else check('the input ring holds no more than the cushion plus its margin', hp.at20.fill <= 20 + Math.max(4 * hp.blockMs, 10) + 0.5, JSON.stringify(hp.at20));
    const untouched = (a, b) => a.dropped === b.dropped && a.skipped === b.skipped && a.outDry === b.outDry && a.inDry === b.inDry;
    check('an 80 ms GUI stall is not in the audio path: nothing dropped, skipped or dry, both hops still at the cushion', untouched(hp.afterStall, hp.at20) && within(hp.afterStall, 20) && (!hp.streams.in || hp.afterStall.fill <= 20 + Math.max(4 * hp.blockMs, 10) + 0.5), JSON.stringify({ before: hp.at20, after: hp.afterStall }));
    check('… nor a 250 ms one, longer than any cushion', untouched(hp.afterLongStall, hp.afterStall) && within(hp.afterLongStall, 20) && (!hp.streams.in || hp.afterLongStall.fill <= 20 + Math.max(4 * hp.blockMs, 10) + 0.5), JSON.stringify({ before: hp.afterStall, after: hp.afterLongStall }));
    check('the cushion moved to 10 ms follows within 1.5 s', within(hp.at10, 10) && (!hp.streams.in || hp.at10.fill <= 10 + Math.max(4 * hp.blockMs, 10) + 0.5), JSON.stringify(hp.at10));
    check('steady state drops nothing and skips nothing: no dropped blocks and no skipped frames in the 1.5 s before the stall', hp.at20.dropped === hp.dropped0 && hp.at20.skipped === hp.skipped0, JSON.stringify({ before: [hp.dropped0, hp.skipped0], at20: [hp.at20.dropped, hp.at20.skipped] }));
  }

  console.log('\n§ the end of a one-shot fades — the segment click (2026-09-04)');
  const ef = await rig.evaluate(async () => {
    const TK = await import('./js/take.js');
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const T = await import('./js/trigger.js');
    const { ensureAudioContext } = await import('./js/audio.js');
    const actx = ensureAudioContext();
    const sr = actx.sampleRate;
    const out = {};
    const keepDwell = S.triggerParams.dwell, keepMuted = S.scanMuted;
    try {
      // A 0.30 s region of full-scale sine that ends mid-cycle: the worst case
      // for a hard stop. Armed as a plain line, fired by hand (the scheduler is
      // quiesced), the source built by one scheduler pass.
      const ch = new Float32Array(sr);
      for (let i = 0; i < ch.length; i++) ch[i] = 0.9 * Math.sin(2 * Math.PI * 333 * i / sr);
      const buf = TK.makeTake(ch, sr);
      S.liveRecBuffers.length = 0; S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
      S.particles.length = 0; S.triggers = [];
      const sid = ++S.strokeIdCounter; S.strokeHistory.push({ strokeId: sid });
      for (let i = 0; i < 6; i++) { const p = { lon: 1.5 + 0.002 * i, lat: 0.3, strokeId: sid, trig: true, source: 'live',
        liveBufferIdx: 0, grainStart: 0.05 + i * 0.05, grainDuration: 0.08, color: '#fff' }; G.stampCartesian(p); S.particles.push(p); }
      S._particleVersion++;
      const keepFx = S.brushFx; S.brushFx = 'none'; T.armTrigger(sid); S.brushFx = keepFx;
      const t = S.triggers[0];
      if (!t) return { error: 'no trigger armed' };
      S.scanMuted = false;
      S.triggerParams.dwell = 'oneshot';
      t.playing = true; t.startOffset = 0; t.trigger.audition = false;
      G.scheduleGrains();
      const gain = t._gainNode, src = t._sourceNode;
      const span = t.loopEnd - t.loopStart;
      out.built = !!gain && !!src;
      out.fade = t._endFade ? { len: +(t._endFade.to - t._endFade.at).toFixed(4), endsAtSpan: +((t._endFade.to - t._startedAt) - span).toFixed(4) } : null;
      out.midVol = gain ? +gain.gain.value.toFixed(3) : null;   // read right after start: the declick has not finished, but it is > 0 within a tick
      await new Promise(r => setTimeout(r, 120));
      out.playingVol = gain ? +gain.gain.value.toFixed(3) : null;
      await new Promise(r => setTimeout(r, span * 1000 + 80));
      out.endVol = gain ? +gain.gain.value.toFixed(4) : null;
      out.ended = !!src?._stopped;
      out.playingCleared = t.playing === false;
      // A trigger dwelling as a LOOP has no end and no end fade.
      S.triggerParams.dwell = 'loop';
      t.playing = true; t.startOffset = 0;
      G.scheduleGrains();
      out.loopFade = t._endFade;
      T.stopTriggerAudio(t, 'immediate', 0.01);
    } finally {
      S.triggerParams.dwell = keepDwell; S.scanMuted = keepMuted;
      S.particles.length = 0; S.triggers = []; S.liveRecBuffers.length = 0;
    }
    return out;
  });
  check('a one-shot builds its source and schedules an end fade of 5 ms ending exactly at its span', ef.built && ef.fade && ef.fade.len === 0.005 && Math.abs(ef.fade.endsAtSpan) < 1e-3, JSON.stringify(ef));
  check('… it plays at full volume in the middle', ef.playingVol === 1, JSON.stringify(ef));
  check('… and the gain is at ZERO once the source has run out — no hard cut', ef.ended && ef.endVol === 0 && ef.playingCleared, JSON.stringify(ef));
  check('a trigger dwelling as a loop gets no end fade (its seam is the loop\'s)', ef.loopFade === null, JSON.stringify(ef.loopFade));

  console.log('\n§ slice — onset segmentation adapts to the floor');
  const sl = await rig.evaluate(async () => {
    const TK = await import('./js/take.js');
    const { S } = await import('./js/state.js');
    const G = await import('./js/grain.js');
    const T = await import('./js/trigger.js');
    const { detectOnsets } = await import('./js/onsets.js');
    const { ensureAudioContext } = await import('./js/audio.js');
    const actx = ensureAudioContext();
    const sr = actx.sampleRate;
    const out = {};

    let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const mk = (sec, floorDb) => {
      const d = new Float32Array(Math.round(sec * sr));
      if (floorDb != null) {
        const a = Math.pow(10, floorDb / 20);
        for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * a;
      }
      return d;
    };
    const hit = (d, at, amp = 0.4) => {
      const s0 = Math.round(at * sr);
      for (let i = 0; i < sr * 0.4 && s0 + i < d.length; i++) {
        const t = i / sr;
        d[s0 + i] += amp * Math.min(1, t / 0.002) * Math.exp(-t * 10) * Math.sin(2 * Math.PI * 250 * t);
      }
    };
    const near = (arr, t, tol = 0.06) => arr.some(v => Math.abs(v - t) <= tol);

    // 1. same hits, three floors — same onsets found
    out.floors = [-60, -30, -18].map(fl => {
      const d = mk(2, fl);
      [0.4, 0.9, 1.5].forEach(t => hit(d, t));
      const on = detectOnsets(d, sr).filter(t => t > 0.01);
      return { fl, n: on.length, ok: on.length === 3 && [0.4, 0.9, 1.5].every(t => near(on, t)) };
    });

    // 2. a slow swell stays whole
    {
      const d = mk(2.5, -30);
      const a = 0.25, s0 = Math.round(0.3 * sr);
      for (let i = 0; i < sr * 2 && s0 + i < d.length; i++) {
        const t = i / sr;
        d[s0 + i] += a * Math.min(1, t / 0.9) * Math.sin(2 * Math.PI * 300 * t);
      }
      const on = detectOnsets(d, sr).filter(t => t > 0.5);
      out.swellExtras = on.length;
    }

    // 3. slice arm: 3 hits over a -24 dB floor + pre-roll → 3 triggers, none
    //    before the first attack
    {
      const ch = new Float32Array(sr * 2);
      const fa = Math.pow(10, -24 / 20);
      for (let i = 0; i < ch.length; i++) ch[i] = (rnd() * 2 - 1) * fa;
      [0.5, 1.0, 1.5].forEach(t => hit(ch, t));
      const buf = TK.makeTake(ch, sr);
      S.liveRecBuffers.length = 0;
      S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
      S.particles.length = 0; S.triggers = [];
      S.strokeHistory = S.strokeHistory || [];
      const sid = ++S.strokeIdCounter;
      S.strokeHistory.push({ strokeId: sid });
      for (let i = 0; i < 38; i++) {
        const p = { lon: 0.9 + 0.002 * i, lat: 0.4, strokeId: sid, trig: true, source: 'live',
                    liveBufferIdx: 0, grainStart: 0.05 + i * 0.05, grainDuration: 0.08, color: '#fff' };
        G.stampCartesian(p); S.particles.push(p);
      }
      S._particleVersion++;
      // SLICE IS A SWITCH since 2026-09-22 (`triggerParams.sliceOn`), not the
      // `slice` tile this set `S.brushFx` for — a key nothing reads now.
      const prevSlice = S.triggerParams.sliceOn;
      S.triggerParams.sliceOn = true;
      T.armTrigger(sid);
      S.triggerParams.sliceOn = prevSlice;
      out.armN = S.triggers.length;
      out.armBounds = S.triggers.map(t => +t.loopStart.toFixed(2));
      // A slice ENDS at the next onset, less the lead: its region must stop
      // short of the next hit rather than at last-mark-plus-spacing, which
      // landed on the attack (the end-of-segment click, 2026-09-04).
      out.armEnds = S.triggers.map(t => ({ end: +t.loopEnd.toFixed(3), cap: t.endCap != null ? +t.endCap.toFixed(3) : null }));
      S.particles.length = 0; S.triggers = []; S.liveRecBuffers.length = 0;
    }

    // 4. min slice: a double-fired cut merges forward; 0 keeps every cut.
    //    Two sharp hits 150 ms apart + one clear of them: at sliceMinMs 250
    //    the middle cut goes (2 triggers), at 0 all three arm.
    {
      const sharpHit = (d, at, amp = 0.5) => {
        const s0 = Math.round(at * sr);
        for (let i = 0; i < sr * 0.1 && s0 + i < d.length; i++) {
          const t = i / sr;
          d[s0 + i] += amp * Math.min(1, t / 0.002) * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 250 * t);
        }
      };
      const arm = () => {
        const ch = new Float32Array(sr * 2);
        const fa = Math.pow(10, -24 / 20);
        for (let i = 0; i < ch.length; i++) ch[i] = (rnd() * 2 - 1) * fa;
        [0.5, 0.65, 1.3].forEach(t => sharpHit(ch, t));
        const buf = TK.makeTake(ch, sr);
        S.liveRecBuffers.length = 0;
        S.liveRecBuffers.push({ buffer: buf, grainCursor: 0 });
        S.particles.length = 0; S.triggers = [];
        const sid = ++S.strokeIdCounter;
        S.strokeHistory.push({ strokeId: sid });
        for (let i = 0; i < 38; i++) {
          const p = { lon: 0.9 + 0.002 * i, lat: 0.4, strokeId: sid, trig: true, source: 'live',
                      liveBufferIdx: 0, grainStart: 0.05 + i * 0.05, grainDuration: 0.08, color: '#fff' };
          G.stampCartesian(p); S.particles.push(p);
        }
        S._particleVersion++;
        const prevSlice = S.triggerParams.sliceOn;
        S.triggerParams.sliceOn = true;
        T.armTrigger(sid);
        S.triggerParams.sliceOn = prevSlice;
        const n = S.triggers.length;
        const bounds = S.triggers.map(t => +t.loopStart.toFixed(2));
        S.particles.length = 0; S.triggers = []; S.liveRecBuffers.length = 0;
        return { n, bounds };
      };
      const prevMin = S.fx.sliceMinMs;
      S.fx.sliceMinMs = 250;
      out.minOn = arm();
      S.fx.sliceMinMs = 0;
      out.minOff = arm();
      S.fx.sliceMinMs = prevMin;
    }
    return out;
  });

  for (const f of sl.floors) {
    check(`onsets found at a ${f.fl} dB floor`, f.ok, `found ${f.n}`);
  }
  check('a slow swell never oversegments', sl.swellExtras === 0, `${sl.swellExtras} extras`);
  check('slice arms one trigger per attack', sl.armN === 3, `${sl.armN}: ${JSON.stringify(sl.armBounds)}`);
  check('each slice carries the next onset as its cut, and its region stops ≥ 12 ms short of it',
        sl.armEnds.length === 3 && sl.armEnds.slice(0, 2).every((e, i) => e.cap != null && Math.abs(e.cap - [1.0, 1.5][i]) <= 0.06 && e.end <= e.cap - 0.012 + 1e-6),
        JSON.stringify(sl.armEnds));
  check('the pre-roll floor arms nothing', !sl.armBounds.some(b => b < 0.4), JSON.stringify(sl.armBounds));
  check('min slice merges a double-fired cut forward', sl.minOn.n === 2 && !sl.minOn.bounds.some(b => b > 0.55 && b < 1.2),
        `${sl.minOn.n}: ${JSON.stringify(sl.minOn.bounds)}`);
  check('min slice 0 keeps every cut', sl.minOff.n === 3, `${sl.minOff.n}: ${JSON.stringify(sl.minOff.bounds)}`);

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
