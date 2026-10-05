// ============================================================================
// UI — SWEEP
// Sweep clears the SCRATCH layer: every mark no pin holds — grain strokes
// outside a pinned cloud's reach, and tape strokes no pinned loop owns (an
// unpinned trigger is scratch, and goes with its marks). Also cleans up
// orphaned live buffers.
// ============================================================================

import { S, MAX_COMMITS } from './state.js';
import { angleBetweenSphere, releaseSeqNodes } from './grain.js';
import { dropTriggersWhere } from './trigger.js';
import { flushWorkletGrains, resyncWorkletBuffers } from './grain-worklet-bridge.js';

// ── Sweep snapshot — allows one-level undo of sweep ──────────────────────────
// Stashed on sweep, restored on undo, permanently discarded on next new action.

import * as history from './history.js';

// ── The material, as one snapshot ───────────────────────────────────────────
// An erase, a sweep or an erase-all is an ACTION on the history stack
// (js/history.js) carrying a BEFORE and an AFTER snapshot of the material —
// arrays of references, not copies. Undo applies the before, redo the after,
// to any depth: the one-slot `S._sweepSnapshot` with its 30-second auto-commit
// is gone (2026-09-05), and with it the rule that a second erase could never
// be undone and the first not after half a minute.
//
// AN ACTION PUTS BACK ONLY WHAT IT CHANGED (Ek, 2026-09-27: "make sure the
// edge cases work when i'm in the middle of recording"). Applying a snapshot
// used to swap the whole board back to it, so anything made SINCE was lost —
// and history.undo() reaches past a take still being recorded, so undo in the
// middle of a take, with an erase before it, destroyed the take: its marks,
// its recording, its history entry. Erasing during a take and undoing later
// cut the take back to its marks at the erase and dropped its trigger. Now
// `applyMaterial(target, other)` restores the target and CARRIES everything
// that is in neither snapshot of the action — a take in progress, the marks
// it laid since, the trigger it armed at release, a pin it made.
//
// Two things are held by IDENTITY rather than read back from the objects,
// because other code rewrites them in place after the snapshot:
//  - the recording each mark and history entry reads (`liveBufferIdx` is an
//    index, and sweep compacts the list, undo of a take splices it);
//  - the stroke each mark belongs to: the erase-split re-ids the cut-off
//    segment in place (trigger.js _assignSegmentIds), so undoing an erase
//    used to leave that piece as a stroke of its own with no trigger — a line
//    that never fired. A stroke being recorded at the snapshot is left as it
//    is: its segments (a slice at the seal) are newer than the action.
export function snapshotMaterial() {
  const bufs = S.liveRecBuffers ? [...S.liveRecBuffers] : [];
  const particles = [...S.particles];
  return {
    particles,
    sids:                 particles.map(p => p.strokeId),
    slotOf:               particles.map(p => p.source === 'live' ? (bufs[p.liveBufferIdx] ?? null) : null),
    liveRecBuffers:       bufs,
    strokeHistory:        [...S.strokeHistory],
    histSlot:             S.strokeHistory.map(h => h.type === 'live' ? (bufs[h.liveBufferIndex] ?? null) : null),
    recordingSid:         S.isPainting ? S.currentStrokeId : -1,
    commitSlots:          S.commitSlots.map(c => c),
    overdubs:             S.commitSlots.map(c => c?.overdubs ? [...c.overdubs] : null),
    // Trigger entries keep their own settings (radius, dwell, start); their
    // particles and region are re-derived from S.particles on the next gate
    // tick, so restoring the array is enough to bring the whole set back.
    triggers:             [...(S.triggers || [])],
  };
}

/** Restore `target`, keeping what is newer than the action. `other` is the
 *  action's opposite snapshot, and `undo` says which way round: undoing, what
 *  is not in the BEFORE is newer — the marks a take laid while the erase was
 *  held are in the after, and must stay; redoing, what is in neither is. An
 *  erase makes no objects of its own but the split's entries and triggers,
 *  which `keepCarried` drops once their marks are theirs no longer. */
export function applyMaterial(target, other = null, undo = true) {
  flushWorkletGrains();
  const snaps = other && !undo ? [target, other] : [target];
  const known = key => new Set(snaps.flatMap(s => s[key]));
  const kParts = known('particles'), kHist = known('strokeHistory'), kTrig = known('triggers');
  const kSlots = new Set(snaps.flatMap(s => s.commitSlots).filter(Boolean));
  const kLayers = new Set(snaps.flatMap(s => s.overdubs.flatMap(o => o || [])));
  const liveSids = new Set([target, other].filter(Boolean).map(s => s.recordingSid).concat(S.isPainting ? [S.currentStrokeId] : []).filter(x => x >= 0));

  // ── Recordings: the target's, then any made since (the take recording now) ─
  const nowBufs = S.liveRecBuffers || [];
  const bufs = [...target.liveRecBuffers];
  const kBufs = new Set(snaps.flatMap(s => s.liveRecBuffers));
  for (const b of nowBufs) if (b && !kBufs.has(b) && !bufs.includes(b)) bufs.push(b);
  // The recording still open — or sealing: the seal reads the index — stays,
  // even when the target predates it (an erase-all moved the take to a fresh slot).
  const recSlot = S.currentLiveBufferIdx >= 0 ? nowBufs[S.currentLiveBufferIdx] : null;
  if (recSlot && !recSlot.buffer && !bufs.includes(recSlot)) bufs.push(recSlot);
  const idxOf = new Map(bufs.map((b, i) => [b, i]));

  // ── Marks: the target's with their stroke and recording, then the newer ────
  const carried = S.particles.filter(p => !kParts.has(p));
  const carriedSlot = carried.map(p => p.source === 'live' ? (nowBufs[p.liveBufferIdx] ?? null) : null);
  target.particles.forEach((p, i) => {
    if (!liveSids.has(p.strokeId) && !liveSids.has(target.sids[i])) p.strokeId = target.sids[i];
    const b = target.slotOf[i];
    if (b) p.liveBufferIdx = idxOf.get(b) ?? -1;
    if (p._gapAfter) p._gapAfter = undefined;
  });
  carried.forEach((p, i) => { const b = carriedSlot[i]; if (b) p.liveBufferIdx = idxOf.get(b) ?? -1; });
  S.particles = [...target.particles, ...carried];
  S._particleVersion++;
  const alive = new Set(S.particles.map(p => p.strokeId));
  // A carried stroke with no marks left is a split the target undoes: its
  // entry and its trigger go. The stroke being recorded may have none yet.
  const keepCarried = sid => alive.has(sid) || liveSids.has(sid);

  // ── Stroke history, by the same rule ─────────────────────────────────────
  const carriedHist = S.strokeHistory.filter(h => !kHist.has(h) && keepCarried(h.strokeId));
  const carriedHistSlot = carriedHist.map(h => h.type === 'live' ? (nowBufs[h.liveBufferIndex] ?? null) : null);
  target.strokeHistory.forEach((h, i) => { const b = target.histSlot[i]; if (b) h.liveBufferIndex = idxOf.get(b) ?? -1; });
  carriedHist.forEach((h, i) => { const b = carriedHistSlot[i]; if (b) h.liveBufferIndex = idxOf.get(b) ?? -1; });
  S.strokeHistory = [...target.strokeHistory, ...carriedHist];

  S.liveRecBuffers = bufs;
  S.currentLiveBufferIdx = recSlot && idxOf.has(recSlot) ? idxOf.get(recSlot) : -1;

  // ── Pins: the target's, and any pinned since stay where they are ──────────
  const displaced = [];
  for (let i = 0; i < S.commitSlots.length; i++) {
    const want = target.commitSlots[i] ?? null, have = S.commitSlots[i];
    if (want === have) {
      // The same pin, but an erase may have taken layers off it — and a take
      // since may have laid one on (a dub by touch), which stays.
      if (want && target.overdubs[i]) {
        const now = want.overdubs || [];
        const back = target.overdubs[i].filter(ov => !now.includes(ov));
        want.overdubs = [...target.overdubs[i], ...now.filter(ov => !kLayers.has(ov))];
        for (const ov of back) S._reattachOverdub?.(want, ov);
      }
      continue;
    }
    if (have && kSlots.has(have)) S._removePinSlot?.(have);
    if (want) {
      if (target.overdubs[i]) want.overdubs = [...target.overdubs[i]];
      if (S.commitSlots[i]) displaced.push(want);   // a pin made since holds this place
      else S._restorePinSlot?.(want, i);
    }
  }
  for (const want of displaced) S._restorePinSlot?.(want);
  if (S.triggers) {
    // A trigger COMING BACK starts outside (2026-09-24, Ek: erase a looping
    // take under the cursor, undo, and "it should start looping since i'm
    // dwelled on it but it doesn't start again till i … move away then go
    // back on it"). The shell is the same object it was, and it left with
    // `_inside` still true — the gate skips a trigger with no marks, so no
    // exit edge was ever seen — and came back the same way, so the tick saw
    // inside → inside and no enter edge. The same rule a walk gate is born
    // under (trigger.js: "a gate starts OUTSIDE — the first touch is the
    // enter edge"). Only the ones coming back: a trigger that stayed on the
    // board through the action is sounding under the cursor and must not be
    // re-entered, which would refire it.
    const stayed = new Set(S.triggers);
    const carriedTrig = S.triggers.filter(t => !kTrig.has(t) && keepCarried(t.strokeId));
    S.triggers.length = 0;
    for (const t of [...target.triggers, ...carriedTrig]) {
      t._builtAt = -1;
      if (!stayed.has(t) && t.trigger) { t.trigger._inside = false; t.trigger._inL = null; t.trigger._bornInL = false; t.playing = false; }
      S.triggers.push(t);
    }
    S._syncTriggerUI?.();
  }
  resyncWorkletBuffers();
  (S.updateSeedBanksUI || (() => {}))();
  S._pinsDirty = true;
  S.updateLiveRecUI?.();
}

/** One erase-like action: `kind` names it on the stack. */
export function materialAction(kind, before, after) {
  return { kind, undo() { applyMaterial(before, after, true); }, redo() { applyMaterial(after, before, false); } };
}

/**
 * Remove all particles not held by a pin: a cloud keeps what is in its reach
 * (a moving one, within reach of any frame along its path), a loop keeps its
 * stroke and its layers' strokes. Everything else is scratch and goes,
 * unpinned tape strokes included.
 * The removal is one action on the history stack, so undo restores it.
 * Returns { removed, kept } counts.
 */
export function sweep() {
  const snapBefore = snapshotMaterial();

  const kept = new Set();

  // ── Clouds: keep particles within each cloud's search radius ──────────
  for (let ci = 0; ci < MAX_COMMITS; ci++) {
    const seed = S.commitSlots[ci];
    if (!seed || seed.type !== 'cloud') continue;

    if (seed.frames) {
      const frames = seed.frames;
      for (let fi = 0; fi < frames.length; fi++) {
        const frame = frames[fi];
        const radiusRad = frame.searchRadiusDeg * Math.PI / 180;
        for (let pi = 0; pi < S.particles.length; pi++) {
          const p = S.particles[pi];
          if (kept.has(p)) continue;
          const ang = angleBetweenSphere(frame.lon, frame.lat, p.lon, p.lat);
          if (ang < radiusRad) kept.add(p);
        }
      }
    } else {
      const radiusRad = seed.searchRadiusDeg * Math.PI / 180;
      for (let pi = 0; pi < S.particles.length; pi++) {
        const p = S.particles[pi];
        const ang = angleBetweenSphere(seed.lon, seed.lat, p.lon, p.lat);
        if (ang < radiusRad) kept.add(p);
      }
    }
  }

  // ── Loops: keep the strokes a pinned loop holds — its own and each
  // overdub layer's. A layer's marks are on the sphere as a tape stroke that
  // was never armed (ui-presets.js, unpin arms them plain), so without this
  // a sweep stripped the marks from under a layer that kept sounding.
  const pinnedStrokes = new Set();
  for (let si = 0; si < MAX_COMMITS; si++) {
    const seq = S.commitSlots[si];
    if (!seq || seq.type !== 'loop') continue;
    pinnedStrokes.add(seq.strokeId);
    for (const ov of (seq.overdubs || [])) pinnedStrokes.add(ov.strokeId);
  }
  for (let pi = 0; pi < S.particles.length; pi++) {
    const p = S.particles[pi];
    if (pinnedStrokes.has(p.strokeId)) kept.add(p);
  }

  // An UNPINNED tape stroke is scratch, and sweep clears scratch (the manual:
  // "a line fires when touched … sweep clears it"). Until 2026-09-24 every
  // armed trigger kept its marks here, so with one pin on the board sweep
  // took the grain strokes and left every tape stroke — Ek: "it only sweeps
  // grains, no tape strokes". A pinned loop's trigger survives through its
  // marks above; the rest go with theirs, below.

  // ── Filter particles ──────────────────────────────────────────────────
  const before = S.particles.length;
  S.particles = S.particles.filter(p => kept.has(p));
  S._particleVersion++;
  const removed = before - S.particles.length;

  // ── Triggers: a shell whose marks just went goes with them, now ───────
  // The gate would drop it on its next tick anyway (refreshTriggers); taking
  // it here makes the sweep silent at once, as erase-all is, and puts the
  // AFTER snapshot on the stack without the ghost.
  const remainingStrokeIds = new Set(S.particles.map(p => p.strokeId));
  dropTriggersWhere(t => !remainingStrokeIds.has(t.strokeId));

  // ── Clean up orphaned live recording buffers ──────────────────────────
  const usedLiveIdxs = new Set();
  for (let pi = 0; pi < S.particles.length; pi++) {
    const p = S.particles[pi];
    if (p.source === 'live') usedLiveIdxs.add(p.liveBufferIdx);
  }

  if (S.liveRecBuffers && S.liveRecBuffers.length > 0) {
    const newBuffers = [];
    const idxMap = new Map();
    for (let i = 0; i < S.liveRecBuffers.length; i++) {
      if (usedLiveIdxs.has(i)) {
        idxMap.set(i, newBuffers.length);
        newBuffers.push(S.liveRecBuffers[i]);
      }
    }
    for (let pi = 0; pi < S.particles.length; pi++) {
      const p = S.particles[pi];
      if (p.source === 'live' && idxMap.has(p.liveBufferIdx)) {
        p.liveBufferIdx = idxMap.get(p.liveBufferIdx);
      }
    }
    S.liveRecBuffers = newBuffers;
    if (idxMap.has(S.currentLiveBufferIdx)) {
      S.currentLiveBufferIdx = idxMap.get(S.currentLiveBufferIdx);
    } else {
      S.currentLiveBufferIdx = newBuffers.length;
    }
  }

  // ── Clean up stroke history ───────────────────────────────────────────
  S.strokeHistory = S.strokeHistory.filter(e => remainingStrokeIds.has(e.strokeId));

  if (removed > 0) history.push(materialAction('sweep', snapBefore, snapshotMaterial()));

  S.updateLiveRecUI?.();
  // The worklet drops the swept takes NOW (2026-09-16). History still holds
  // them on the main thread, so undo can bring them back — resync re-registers
  // what it finds missing — and the audio thread stops carrying a second copy
  // of material nothing can read. docs/RULINGS.md "Undo is unbounded".
  resyncWorkletBuffers();

  return { removed, kept: S.particles.length };
}

// ── UI wiring ────────────────────────────────────────────────────────────────



// ── Session panel wiring ────────────────────────────────────────────────────

function flashSessionBtn(btn, labelHtml, msg, cssClass = 'flashing', ms = 1200) {
  const prev = btn.innerHTML;
  btn.textContent = msg;
  btn.classList.add(cssClass);
  setTimeout(() => { btn.innerHTML = prev; btn.classList.remove(cssClass); }, ms);
}

/** Erase everything — particles, buffers, strokes, seeds, loops. Clean slate. */
function eraseAll() {
  const count = S.particles.length;
  const hadCommits = S.commitSlots.some(s => s !== null);
  if (count === 0 && !hadCommits) return 0;
  const before = snapshotMaterial();
  // Stop all in-flight grains so they don't ring out
  flushWorkletGrains();

  // Clear particles & buffers
  S.particles = [];
  S._particleVersion++;
  // Triggers are views onto those particles — with the material gone they have
  // nothing to be. Cleared explicitly rather than left to the gate's own
  // rebuild, because erase-all should be silent immediately, not one tick later.
  S._clearAllTriggers?.();
  if (S.liveRecBuffers) {
    S.liveRecBuffers.length = 0;
    S.currentLiveBufferIdx = 0;
  }
  S.strokeHistory = [];
  // Clear all commits (instant, no release ramp).
  // Full node release (perf audit M2, Jul 2026) — stop() alone left the
  // loop's gain + per-speaker VBAP fan-out connected to the buses.
  for (let i = 0; i < MAX_COMMITS; i++) {
    const slot = S.commitSlots[i];
    if (slot && slot.type === 'loop') releaseSeqNodes(slot);
    S.commitSlots[i] = null;
  }
  (S.updateSeedBanksUI || (() => {}))();
  S.updateLiveRecUI?.();
  history.push(materialAction('erase-all', before, snapshotMaterial()));

  // If recording is still active, re-create a fresh buffer slot so new
  // particles from the ongoing recording have somewhere to land.
  //
  // Do NOT re-init the provisional live buffer (S._beginProvisionalRecording).
  // That reset the worklet's live accumulator to zero while the main-thread
  // recording (recordingRaw/writePos) kept counting from the spacebar press —
  // desyncing the two by the pre-erase duration. Post-erase particles carry
  // continuous-time offsets, so their grains pointed past the end of the
  // restarted worklet buffer (dropped → silence), then read time-shifted
  // audio as it regrew, only snapping right at record release when the
  // finalized buffer hot-swapped in. Keeping the worklet accumulator
  // continuous keeps offsets valid on both sides; erased material is simply
  // unreachable (no particles reference it) and is freed at snapshot commit.
  // The _bufferMap liveBuffer entry (cleared by flushWorkletGrains above) is
  // re-registered by the next rebuildLiveBuffer tick via _onLiveBufferRebuilt.
  if (S.isRecording) {
    S.currentLiveBufferIdx = 0;
    S.liveRecBuffers.push({ buffer: null, grainCursor: 0 });
  }
  // As in sweep(): the worklet lets the erased takes go, history keeps them.
  resyncWorkletBuffers();

  return count + (hadCommits ? 1 : 0);
}

function doSweep(sweepBtn) {
  if (S.isPainting) return;
  window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'sweep' } }));
  const hasActive = S.commitSlots.some(c => c !== null);
  if (!hasActive) {
    const count = eraseAll();
    if (sweepBtn) flashSessionBtn(sweepBtn, sweepBtn.innerHTML, count > 0 ? `✓ swept ${count}` : '✓ clean', 'sweep-flash');
  } else {
    const { removed } = sweep();
    if (sweepBtn) flashSessionBtn(sweepBtn, sweepBtn.innerHTML, removed > 0 ? `✓ swept ${removed}` : '✓ clean', 'sweep-flash');
  }
}

// doEraseAll is defined inside initSessionPanel so it can share _eraseFlashTimer
// (see below).  This stub exists only so doSweep can still reference eraseAll().


export function initSessionPanel() {
  // ── Undo ──
  const undoBtn = document.getElementById('sessionUndoBtn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => S._undoLastStroke?.());
  }

  // ── Alt-lock indicator ──
  const altLockBtn = document.getElementById('sessionAltLockBtn');
  if (altLockBtn) {
    // Sync visual state when alt-lock changes (driven from events.js)
    S._syncSessionAltLock = (locked) => {
      altLockBtn.classList.toggle('active', locked);
    };
  }

  // ── Mute ──
  const muteBtn = document.getElementById('sessionMuteBtn');
  if (muteBtn) {
    const muteLabel = muteBtn.innerHTML;
    const unmuteLabel = muteLabel.replace('>mute<', '>unmute<');
    const syncMute = () => {
      muteBtn.classList.toggle('active', S.isMuted);
      muteBtn.innerHTML = S.isMuted ? unmuteLabel : muteLabel;
    };
    muteBtn.addEventListener('click', () => {
      S._setMuted?.(!S.isMuted);
      syncMute();
    });
    S._syncSessionMute = syncMute;
  }

  // ── Sweep ──
  const sweepBtn = document.getElementById('sessionSweepBtn');
  if (sweepBtn) sweepBtn.addEventListener('click', () => doSweep(sweepBtn));
  // Expose for keyboard shortcut
  S._sessionSweep = () => doSweep(sweepBtn);

  // ── Erase all ──
  const eraseBtn = document.getElementById('sessionEraseBtn');
  // Capture original label once at init — single source of truth
  const eraseOrigHtml = eraseBtn ? eraseBtn.innerHTML : '';
  let _eraseFlashTimer = null;

  function eraseRestore() {
    if (_eraseFlashTimer) { clearTimeout(_eraseFlashTimer); _eraseFlashTimer = null; }
    if (eraseBtn) { eraseBtn.innerHTML = eraseOrigHtml; eraseBtn.style.borderColor = ''; }
  }

  if (eraseBtn) {
    eraseBtn.addEventListener('click', () => doEraseAllLocal());
  }
  // Erase-all action — lives here so it shares _eraseFlashTimer with progress
  function doEraseAllLocal() {
    window.dispatchEvent(new CustomEvent('mubone-led', { detail: { id: 'erase_all' } }));
    const count = eraseAll();
    if (eraseBtn) {
      eraseRestore();  // cancel any pending timer first
      const msg = count > 0 ? `✓ erased ${count}` : '✓ empty';
      eraseBtn.textContent = msg;
      eraseBtn.classList.add('flashing');
      _eraseFlashTimer = setTimeout(() => {
        eraseBtn.classList.remove('flashing');
        eraseRestore();
      }, 1200);
    }
  }

  S._sessionEraseAll = () => { eraseRestore(); doEraseAllLocal(); };
  S._eraseAllProgress = (count) => {
    if (!eraseBtn) return;
    eraseRestore();
    if (count <= 0) return;
    eraseBtn.textContent = `Del ${count}/3`;
    eraseBtn.style.borderColor = 'rgba(224,96,96,0.4)';
    _eraseFlashTimer = setTimeout(eraseRestore, 900);
  };
}
