// ============================================================================
// UI — SWEEP
// One-click removal of all particles not associated with active seeds
// (stationary or moving) or loops (seqs).  Also cleans up orphaned live buffers.
// ============================================================================

import { S, MAX_SEEDS, MAX_SEQS } from './state.js';
import { angleBetweenSphere } from './grain.js';
import { clearAllSeqs } from './ui-presets.js';

// ── Sweep snapshot — allows one-level undo of sweep ──────────────────────────
// Stashed on sweep, restored on undo, permanently discarded on next new action.

/**
 * Restore a pending sweep snapshot. Called by undoLastStroke when a snapshot
 * exists. Returns true if a snapshot was restored, false if none was pending.
 */
export function undoSweep() {
  if (!S._sweepSnapshot) return false;
  const snap = S._sweepSnapshot;
  S.particles            = snap.particles;
  S.liveRecBuffers       = snap.liveRecBuffers;
  S.currentLiveBufferIdx = snap.currentLiveBufferIdx;
  S.strokeHistory        = snap.strokeHistory;
  S._particleVersion++;
  // Restore seeds/loops if they were part of the snapshot (erase-all)
  if (snap.seedSlots) {
    for (let i = 0; i < snap.seedSlots.length; i++) S.seedSlots[i] = snap.seedSlots[i];
    (S.updateSeedBanksUI || (() => {}))();
  }
  if (snap.seqSlots) {
    for (let i = 0; i < snap.seqSlots.length; i++) S.seqSlots[i] = snap.seqSlots[i];
  }
  S._sweepSnapshot = null;
  S.updateLiveRecUI?.();
  return true;
}

/**
 * Discard any pending sweep snapshot — called when a new action makes the
 * sweep permanent (e.g. new paint stroke, sow, arm loop).
 */
let _sweepAutoCommitTimer = null;
export function commitSweep() {
  if (_sweepAutoCommitTimer) { clearTimeout(_sweepAutoCommitTimer); _sweepAutoCommitTimer = null; }
  S._sweepSnapshot = null;
}

/**
 * Schedule auto-commit of the sweep snapshot after a delay.
 * Frees buffer memory even if the performer never paints again.
 * 30s is long enough to undo a mistake, short enough to reclaim RAM.
 */
function scheduleSweepAutoCommit() {
  if (_sweepAutoCommitTimer) clearTimeout(_sweepAutoCommitTimer);
  _sweepAutoCommitTimer = setTimeout(() => {
    S._sweepSnapshot = null;
    _sweepAutoCommitTimer = null;
    S.updateLiveRecUI?.(); // refresh HUD (recTotalSec may have dropped)
  }, 30000);
}

// ── Core sweep logic ─────────────────────────────────────────────────────────

/**
 * Remove all particles not referenced by any active seed or loop.
 * Moving seeds keep particles within reach of any frame along their path.
 * The removed data is stashed in S._sweepSnapshot so undo can restore it.
 * Returns { removed, kept } counts.
 */
export function sweep() {
  // Snapshot the current state before we modify anything
  S._sweepSnapshot = {
    particles:            [...S.particles],
    liveRecBuffers:       S.liveRecBuffers ? [...S.liveRecBuffers] : [],
    currentLiveBufferIdx: S.currentLiveBufferIdx,
    strokeHistory:        [...S.strokeHistory],
  };

  const kept = new Set();

  // ── Seeds: keep particles within each seed's search radius ──────────
  for (let ci = 0; ci < MAX_SEEDS; ci++) {
    const seed = S.seedSlots[ci];
    if (!seed) continue;

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

  // ── Loops (seqs): keep all particles belonging to active loops ────────
  for (let si = 0; si < MAX_SEQS; si++) {
    const seq = S.seqSlots[si];
    if (!seq) continue;
    const seqStrokeId = seq.strokeId;
    for (let pi = 0; pi < S.particles.length; pi++) {
      const p = S.particles[pi];
      if (p.strokeId === seqStrokeId) kept.add(p);
    }
  }

  // ── Filter particles ──────────────────────────────────────────────────
  const before = S.particles.length;
  S.particles = S.particles.filter(p => kept.has(p));
  S._particleVersion++;
  const removed = before - S.particles.length;

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
  const remainingStrokeIds = new Set(S.particles.map(p => p.strokeId));
  S.strokeHistory = S.strokeHistory.filter(e => remainingStrokeIds.has(e.strokeId));

  // If nothing was actually removed, no need for a snapshot
  if (removed === 0) {
    S._sweepSnapshot = null;
  } else {
    scheduleSweepAutoCommit(); // auto-free snapshot memory after 30s
  }

  S.updateLiveRecUI?.();

  return { removed, kept: S.particles.length };
}

// ── UI wiring ────────────────────────────────────────────────────────────────

export function initSweepUI() {
  const btn = document.getElementById('sweepBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (S.isPainting) return;

    const hasActive = S.seedSlots.some(c => c !== null)
                   || S.seqSlots.some(s => s !== null);

    if (!hasActive) {
      const count = S.particles.length;
      if (count === 0) { flashSweepFeedback(btn, 0, 0); return; }
      // Stash snapshot before clearing everything
      S._sweepSnapshot = {
        particles:            [...S.particles],
        liveRecBuffers:       S.liveRecBuffers ? [...S.liveRecBuffers] : [],
        currentLiveBufferIdx: S.currentLiveBufferIdx,
        strokeHistory:        [...S.strokeHistory],
      };
      S.particles = [];
      S._particleVersion++;
      if (S.liveRecBuffers) {
        S.liveRecBuffers.length = 0;
        S.currentLiveBufferIdx = 0;
      }
      S.strokeHistory = [];
      S.updateLiveRecUI?.();
      scheduleSweepAutoCommit();
      flashSweepFeedback(btn, count, 0);
      return;
    }

    const { removed, kept } = sweep();
    flashSweepFeedback(btn, removed, kept);
  });
}

function flashSweepFeedback(btn, removed, kept) {
  if (removed === 0) {
    btn.textContent = '✓ nothing to sweep';
  } else {
    btn.textContent = `✓ swept ${removed}`;
  }
  btn.classList.add('sweep-flash');
  setTimeout(() => {
    btn.textContent = '⌁ sweep';
    btn.classList.remove('sweep-flash');
  }, 1500);
}

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
  const hadSeeds = S.seedSlots.some(s => s !== null);
  const hadSeqs  = S.seqSlots.some(s => s !== null);
  if (count === 0 && !hadSeeds && !hadSeqs) return 0;
  // Stash snapshot for undo
  S._sweepSnapshot = {
    particles:            [...S.particles],
    liveRecBuffers:       S.liveRecBuffers ? [...S.liveRecBuffers] : [],
    currentLiveBufferIdx: S.currentLiveBufferIdx,
    strokeHistory:        [...S.strokeHistory],
    seedSlots:            S.seedSlots.map(s => s),   // shallow copy of slot refs
    seqSlots:             S.seqSlots.map(s => s),
  };
  // Clear particles & buffers
  S.particles = [];
  S._particleVersion++;
  if (S.liveRecBuffers) {
    S.liveRecBuffers.length = 0;
    S.currentLiveBufferIdx = 0;
  }
  S.strokeHistory = [];
  // Clear seeds (instant, no release ramp) and loops
  for (let i = 0; i < MAX_SEEDS; i++) S.seedSlots[i] = null;
  (S.updateSeedBanksUI || (() => {}))();
  clearAllSeqs();
  S.updateLiveRecUI?.();
  scheduleSweepAutoCommit();
  return count + (hadSeeds ? 1 : 0) + (hadSeqs ? 1 : 0);
}

function doSweep(sweepBtn) {
  if (S.isPainting) return;
  const hasActive = S.seedSlots.some(c => c !== null)
                 || S.seqSlots.some(s => s !== null);
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
    if (S.isPainting) return;
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
