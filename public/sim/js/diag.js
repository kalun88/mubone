// ============================================================================
// DIAG — crash / overload diagnostic reporter + rolling event log
//
// Captures a snapshot of all CPU / audio / grain state into a plain-text
// report you can copy and paste.
//
// Triggers:
//   • Automatic — window.onerror and unhandledrejection (JS crash)
//   • Manual    — press Shift+D anywhere in the app
//   • Console   — window.diagReport()  (returns the text; also shows overlay)
//
// Rolling event log (ring buffer):
//   dlog(tag, msg)  — always writes to buffer, console.log when ?debug active
//   dlogDump()      — returns last DLOG_SIZE events as formatted text
//   window.dlog()   — console access to the buffer
//
// The ring buffer runs even without ?debug so crash reports always include
// the event timeline.  Overhead is negligible (array push + modulo).
// ============================================================================

import { S, DEBUG, perf, PRESETS, GRAIN_SCHEDULER_INTERVAL_MS } from './state.js';

// ── Rolling event log (ring buffer) ─────────────────────────────────────────

const DLOG_SIZE = 500;          // keep last 500 events
const _dlogBuf  = new Array(DLOG_SIZE);
let   _dlogIdx  = 0;
let   _dlogLen  = 0;            // how many entries written (caps at DLOG_SIZE)

/**
 * Log a diagnostic event.  Always written to the ring buffer.
 * When ?debug is active, also printed to the console.
 *
 * @param {string} tag   Short module tag, e.g. 'grain', 'audio', 'ctx'
 * @param {string} msg   Human-readable description
 * @param {object} [data] Optional numeric snapshot (kept as-is, no cloning)
 */
export function dlog(tag, msg, data) {
  const t = performance.now();
  const entry = { t, tag, msg, data: data || null };
  _dlogBuf[_dlogIdx] = entry;
  _dlogIdx = (_dlogIdx + 1) % DLOG_SIZE;
  if (_dlogLen < DLOG_SIZE) _dlogLen++;
  if (DEBUG) {
    const prefix = `[${tag}] ${t.toFixed(1)}ms`;
    if (data) console.log(prefix, msg, data);
    else      console.log(prefix, msg);
  }
}

/**
 * Return the ring buffer contents as a formatted string (oldest → newest).
 * @param {number} [last=100] How many recent entries to include.
 */
export function dlogDump(last = 100) {
  const count = Math.min(last, _dlogLen);
  const start = (_dlogIdx - count + DLOG_SIZE) % DLOG_SIZE;
  const lines = [];
  for (let i = 0; i < count; i++) {
    const e = _dlogBuf[(start + i) % DLOG_SIZE];
    if (!e) continue;
    const ts   = (e.t / 1000).toFixed(3);           // seconds since page load
    const data = e.data ? '  ' + JSON.stringify(e.data) : '';
    lines.push(`${ts}s [${e.tag}] ${e.msg}${data}`);
  }
  return lines.join('\n');
}

// ── Report generator ─────────────────────────────────────────────────────────

export function generateDiagReport(triggerLabel = 'manual', error = null) {
  const ts   = new Date().toISOString();
  const actx = S.audioCtx;
  const ep   = S.grainParams  ?? {};
  const ov   = S.grainOverrides ?? {};

  // ── helpers ──
  const ms2  = n  => (typeof n === 'number' ? n.toFixed(2) + ' ms' : 'n/a');
  const pct  = (v, total) => total > 0 ? ((v / total) * 100).toFixed(0) + '%' : 'n/a';
  const cents = v => {
    if (typeof v !== 'number' || v <= 0) return '0¢';
    return '±' + Math.round(1200 * Math.log2(1 + v)) + '¢';
  };
  const eff = (key) => {        // effective value: override ?? preset
    const v = ov[key] !== undefined ? ov[key] : ep[key];
    return v;
  };

  // ── current preset name ──
  const idx         = S.activePresetIndex ?? 0;
  const presetName  = PRESETS[idx]?.name ?? '?';
  const presetLabel = `${idx + 1} — ${presetName}`;

  // ── grain params ──
  const effPeriod  = eff('period')   ?? 0;
  const effDur     = eff('duration') ?? 0;
  const dutyCycle  = effPeriod > 0 ? ((effDur / effPeriod) * 100).toFixed(0) + '%' : 'n/a';
  const effPitch   = eff('pitchJitter') ?? 0;
  const effVol     = eff('volume')      ?? 1;
  const effProb    = eff('probability') ?? 1;
  const effAtk     = eff('attack')      ?? 0.25;
  const effRel     = eff('release')     ?? 0.25;
  const effDurVar  = eff('durVar')      ?? 0;
  const effPan     = eff('panSpread')   ?? 0;

  const activeOvKeys = Object.keys(ov).filter(k => ov[k] !== undefined);

  // ── audio context ──
  const acState    = actx?.state              ?? 'not created';
  const acRate     = actx?.sampleRate         ?? 'n/a';
  const acTime     = actx?.currentTime        != null ? actx.currentTime.toFixed(3) + ' s' : 'n/a';
  const acBase     = actx?.baseLatency        != null ? (actx.baseLatency * 1000).toFixed(1) + ' ms' : 'n/a';
  const acOutput   = actx?.outputLatency      != null ? (actx.outputLatency * 1000).toFixed(1) + ' ms' : 'n/a';

  // ── particle / seed counts ──
  const particleCount = S.particles?.length ?? 0;
  const seedCount    = S.activeSeeds
    ? Object.values(S.activeSeeds).filter(c => c?.active).length
    : 0;

  // ── loaded samples ──
  const sampleCount = S.loadedSamples
    ? Object.values(S.loadedSamples).filter(Boolean).length
    : (S.audioBuffer ? 1 : 0);

  // ── format the report ──
  const lines = [
    '╔══════════════════════════════════════════════════════════════╗',
    '  GRAIN ENGINE DIAGNOSTIC REPORT',
    `  ${ts}`,
    `  trigger: ${triggerLabel}`,
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    '── AUDIO CONTEXT ──────────────────────────────────────────────',
    `  state          : ${acState}`,
    `  sample rate    : ${acRate} Hz`,
    `  current time   : ${acTime}`,
    `  base latency   : ${acBase}`,
    `  output latency : ${acOutput}`,
    '',
    '── PERFORMANCE ────────────────────────────────────────────────',
    `  frame time     : ${ms2(perf.frameMs)}  (max ${ms2(perf.frameMsMax)})`,
    `  scheduler drift: ${ms2(perf.schedulerDrift)}  (max ${ms2(perf.schedulerMax)})`,
    `  scheduler interval target: ${GRAIN_SCHEDULER_INTERVAL_MS} ms`,
    `  audio underruns: ${perf.underruns}`,
    `  active grains  : ${perf.activeNodes} / 256  (${pct(perf.activeNodes, 256)})  [worklet pool]`,
    `  seeds posted   : ${perf.seedsPosted} (active seeds → worklet, last tick)`,
    '',
    '── GRAIN PARAMETERS ───────────────────────────────────────────',
    `  preset         : ${presetLabel}`,
    `  period         : ${(effPeriod * 1000).toFixed(1)} ms`,
    `  duration       : ${(effDur * 1000).toFixed(1)} ms  (duty cycle: ${dutyCycle})`,
    `  pitch jitter   : ${cents(effPitch)}  (internal: ${typeof effPitch === 'number' ? effPitch.toFixed(4) : 'n/a'})`,
    `  attack         : ${(effAtk * 100).toFixed(0)}%`,
    `  release        : ${(effRel * 100).toFixed(0)}%`,
    `  dur variance   : ${(effDurVar * 1000).toFixed(1)} ms`,
    `  dur jitter     : ${Math.round((S.grainOverrides.durJitter ?? S.grainParams.durJitter ?? 0) * 100)}%`,
    `  pan spread     : ${effPan}`,
    `  volume         : ${effVol}`,
    `  probability    : ${(effProb * 100).toFixed(0)}%`,
    `  curve type     : ${S.grainCurveType ?? 'n/a'}`,
    `  direction      : ${S.grainDirection ?? 'n/a'}`,
    '',
    '── UI OVERRIDES ────────────────────────────────────────────────',
    activeOvKeys.length
      ? activeOvKeys.map(k => `  ${k.padEnd(14)}: ${JSON.stringify(ov[k])}`).join('\n')
      : '  (none)',
    '',
    '── SCENE ───────────────────────────────────────────────────────',
    `  active particles : ${particleCount}`,
    `  active seeds     : ${seedCount}`,
    `  loaded samples   : ${sampleCount}`,
    `  camera mode      : ${S.cameraMode ?? 'n/a'}`,
    `  spatial panning  : ${S.spatialPanning ?? 'n/a'}`,
    `  speaker buses    : ${S.speakerBuses?.length ?? 0}`,
  ];

  if (error) {
    lines.push('');
    lines.push('── ERROR ───────────────────────────────────────────────────────');
    if (error instanceof ErrorEvent) {
      lines.push(`  message : ${error.message}`);
      lines.push(`  file    : ${error.filename}:${error.lineno}:${error.colno}`);
      if (error.error?.stack) {
        lines.push('  stack:');
        error.error.stack.split('\n').forEach(l => lines.push('    ' + l));
      }
    } else if (error instanceof PromiseRejectionEvent) {
      const r = error.reason;
      lines.push(`  reason  : ${r?.message ?? r}`);
      if (r?.stack) {
        lines.push('  stack:');
        r.stack.split('\n').forEach(l => lines.push('    ' + l));
      }
    } else if (error instanceof Error) {
      lines.push(`  message : ${error.message}`);
      if (error.stack) {
        lines.push('  stack:');
        error.stack.split('\n').forEach(l => lines.push('    ' + l));
      }
    } else {
      lines.push(`  ${String(error)}`);
    }
  }

  // ── Event timeline (last 80 ring-buffer entries) ──
  const timeline = dlogDump(80);
  if (timeline) {
    lines.push('');
    lines.push('── EVENT TIMELINE (newest at bottom) ───────────────────────────');
    lines.push(timeline);
  }

  lines.push('');
  lines.push('────────────────────────────────────────────────────────────────');
  return lines.join('\n');
}

// ── Overlay UI ───────────────────────────────────────────────────────────────

let _overlayEl = null;

function _ensureOverlay() {
  if (_overlayEl) return _overlayEl;

  const overlay = document.createElement('div');
  overlay.id = 'diagOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,0.82)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'font-family:monospace', 'font-size:12px',
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = [
    'background:#111e1e',
    'border:1px solid #2a4a4a',
    'border-radius:6px',
    'padding:16px',
    'max-width:700px', 'width:90%',
    'max-height:80vh',
    'display:flex', 'flex-direction:column',
    'gap:10px',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  const title = document.createElement('span');
  title.textContent = 'DIAGNOSTIC REPORT';
  title.style.cssText = 'color:#7abcbc;letter-spacing:0.1em;font-weight:bold;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = [
    'background:none', 'border:none', 'color:#7abcbc',
    'cursor:pointer', 'font-size:16px', 'padding:0 4px',
  ].join(';');
  closeBtn.addEventListener('click', hideOverlay);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const pre = document.createElement('pre');
  pre.id = 'diagReportText';
  pre.style.cssText = [
    'flex:1', 'overflow:auto',
    'margin:0', 'padding:8px',
    'background:#0d1818',
    'border:1px solid #1a3030',
    'border-radius:4px',
    'color:#b0d4d4',
    'white-space:pre',
    'font-size:11px',
    'line-height:1.5',
    'min-height:200px',
  ].join(';');

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy to clipboard';
  copyBtn.style.cssText = [
    'background:#1a3a3a', 'border:1px solid #2a5a5a',
    'color:#7abcbc', 'cursor:pointer',
    'padding:6px 14px', 'border-radius:4px',
    'font-family:monospace', 'font-size:12px',
  ].join(';');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(pre.textContent).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 1500);
    });
  });

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh';
  refreshBtn.style.cssText = copyBtn.style.cssText;
  refreshBtn.addEventListener('click', () => {
    pre.textContent = generateDiagReport('manual (refreshed)');
  });

  footer.appendChild(refreshBtn);
  footer.appendChild(copyBtn);

  const hint = document.createElement('div');
  hint.style.cssText = 'color:#3a5a5a;font-size:10px;text-align:center;';
  hint.textContent = 'Press Shift+D or Esc to close  ·  window.diagReport() in console for text only';

  box.appendChild(header);
  box.appendChild(pre);
  box.appendChild(footer);
  box.appendChild(hint);
  overlay.appendChild(box);

  // click backdrop to close
  overlay.addEventListener('click', e => { if (e.target === overlay) hideOverlay(); });

  document.body.appendChild(overlay);
  _overlayEl = overlay;
  return overlay;
}

export function showDiagOverlay(triggerLabel = 'manual', error = null) {
  const overlay = _ensureOverlay();
  const pre     = document.getElementById('diagReportText');
  if (pre) pre.textContent = generateDiagReport(triggerLabel, error);
  overlay.style.display = 'flex';
}

export function hideOverlay() {
  if (_overlayEl) _overlayEl.style.display = 'none';
}

// ── localStorage auto-save (disabled) ────────────────────────────────────────
// Previously saved a snapshot every 5s for crash recovery.
// Removed to avoid unnecessary periodic writes.

// ── Init: wire up auto-capture + keyboard shortcut ───────────────────────────

export function initDiag() {
  // Clean up any legacy crash snapshot from localStorage
  try { localStorage.removeItem('grainDiagSnapshot'); } catch (_) {}

  // ── Auto-capture JS crashes ──
  window.addEventListener('error', (e) => {
    showDiagOverlay('window.onerror (crash)', e);
  });

  window.addEventListener('unhandledrejection', (e) => {
    showDiagOverlay('unhandledrejection (crash)', e);
  });

  // ── Shift+D to open/close; Esc to close ──
  window.addEventListener('keydown', (e) => {
    if (e.key === 'D' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (_overlayEl?.style.display !== 'none' && _overlayEl?.style.display) {
        hideOverlay();
      } else {
        showDiagOverlay('manual (Shift+D)');
      }
    }
    if (e.key === 'Escape' && _overlayEl?.style.display === 'flex') {
      hideOverlay();
    }
  });

  // ── Console helpers ──
  window.diagReport = () => {
    const txt = generateDiagReport('console');
    showDiagOverlay('console (window.diagReport)');
    return txt;
  };
  // Event log access from console:
  //   dlog()      — print last 100 events
  //   dlog(300)   — print last 300 events
  window.dlog = (n) => { const txt = dlogDump(n || 100); console.log(txt); return txt; };
}
