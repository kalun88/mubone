// ============================================================================
// UI — SWEEP
// One-click removal of all particles not associated with active seeds
// (stationary or moving) or loops (seqs).  Also cleans up orphaned live buffers.
// ============================================================================

import { S, MAX_SEEDS, MAX_SEQS } from './state.js';
import { angleBetweenSphere } from './grain.js';

// ── Core sweep logic ─────────────────────────────────────────────────────────

/**
 * Remove all particles not referenced by any active seed or loop.
 * Moving seeds keep particles within reach of any frame along their path.
 * Returns { removed, kept } counts.
 */
export function sweep() {
  const kept = new Set();

  // ── Seeds: keep particles within each seed's search radius ──────────
  for (let ci = 0; ci < MAX_SEEDS; ci++) {
    const seed = S.seedSlots[ci];
    if (!seed) continue;

    if (seed.frames) {
      // Moving seed: keep particles reachable by any frame along the path
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
      // Stationary seed: keep particles within search radius of fixed position
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
      S.particles = [];
      S._particleVersion++;
      if (S.liveRecBuffers) {
        S.liveRecBuffers.length = 0;
        S.currentLiveBufferIdx = 0;
      }
      S.strokeHistory = [];
      S.updateLiveRecUI?.();
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
