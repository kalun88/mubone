// ============================================================================
// ui-diagnostics.js — measurements you run, and verdicts you read
//
// The line against the sensors page: Sensors is what each thing IS and how it
// is SET; this page is what you MEASURE and what the answer means. Nothing is
// duplicated across that line — a reading that belongs to one sensor stays on
// its card.
//
// NOTHING HERE RUNS ON A TIMER. Every tool is one-shot, on a press, and takes
// its instrumentation back off when it finishes. The rig's scheduler drift sits
// under 1 ms at p95 against a 20 ms tick (measured 2026-08-31) and this page is
// not allowed to move it. A live readout belongs on the sensor card, where the
// rAF loop already pays for it.
// ============================================================================

import { S } from './state.js';
import { links } from './sygaldry.js';
import { generateDiagReport, showDiagOverlay } from './diag.js';

const el = (id) => document.getElementById(id);

// ── The bands a measurement is read against ─────────────────────────────────
// From docs/RIG-RUNBOOK.md § 6, which are measurements not guesses: a clean
// link loses nothing and never stalls past a render frame; a bad one loses
// tens of percent and stalls for hundreds of milliseconds.
const GOOD = { lostPct: 1, stalls33: 2 };
const POOR = { lostPct: 5, stalls33: 8 };

function verdict(lostPct, stalls33) {
  if (lostPct <= GOOD.lostPct && stalls33 <= GOOD.stalls33) return ['ok', 'Cable-grade'];
  if (lostPct <= POOR.lostPct && stalls33 <= POOR.stalls33) return ['warn', 'Usable, some jitter'];
  return ['err', 'This will jitter'];
}

function setBadge(node, kind, text) {
  if (!node) return;
  node.className = 'set-badge' + (kind ? ' set-badge--' + kind : '');
  node.textContent = text;
}

// ── Link quality ────────────────────────────────────────────────────────────

async function measureLink(seconds = 6) {
  const link = links().find((l) => l.connected);
  if (!link) return { error: 'no instrument connected' };

  const t = [], seq = [];
  const untap = link.tap((address, args) => {
    if (address === '/BNO085/orientation') t.push(performance.now());
    else if (address === '/syg/sequence_number') seq.push(args[0]);
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  untap();

  if (t.length < 20) return { error: 'too few samples — is the sensor streaming?' };

  const d = [];
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  const sorted = [...d].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor(sorted.length * p)];

  let missing = 0;
  for (let i = 1; i < seq.length; i++) missing += Math.max(0, seq[i] - seq[i - 1] - 1);
  const lostPct = seq.length ? (100 * missing) / (missing + seq.length) : 0;

  return {
    via: link.transport === 'websocket' ? 'wifi' : 'cable',
    arriving: t.length / seconds,
    produced: link.latest('/BNO085/report_rate')?.[0] ?? null,
    lostPct, p99: pct(0.99), max: sorted[sorted.length - 1],
    stalls33: d.filter((x) => x > 33).length,
    stalls100: d.filter((x) => x > 100).length,
  };
}

// ── Show readiness ──────────────────────────────────────────────────────────
// Four things that each have to be true, and are otherwise four numbers on two
// other pages with thresholds you have to remember.

function readiness() {
  const link = links().find((l) => l.connected);
  if (!link) return { kind: 'err', text: 'No instrument', notes: ['nothing connected'] };

  const notes = [];
  let kind = 'ok';
  const bad  = (m) => { notes.push(m); kind = 'err'; };
  const warn = (m) => { notes.push(m); if (kind === 'ok') kind = 'warn'; };

  const cal = link.latest('/BNO085/calibration_enabled')?.[0];
  // Resets to 0 on EVERY boot however it was left — docs/RIG-RUNBOOK.md § 4.
  if (cal === 0) bad('calibration is off (it resets on every power-up)');
  else if (cal !== 7 && cal != null) warn(`calibration partial (${cal} of 7)`);

  const acc = link.latest('/BNO085/accuracy')?.[0];
  if (acc != null) {
    const deg = (acc * 180) / Math.PI;
    if (deg > 25) bad(`heading confidence ±${deg.toFixed(0)}° — run the ritual`);
    else if (deg > 10) warn(`heading confidence ±${deg.toFixed(0)}°`);
  }

  const produced = link.latest('/BNO085/report_rate')?.[0];
  const asked = link.latest('/BNO085/configured_rate')?.[0];
  if (produced != null && asked) {
    if (produced < asked * 0.85) warn(`sensor delivering ${produced.toFixed(0)} of ${asked} Hz`);
  }

  if (S.cameraMode !== 'sensor') warn(`camera mode is “${S.cameraMode}” — the sphere will not move`);

  if (!notes.length) notes.push('calibrated, streaming, camera on sensor');
  return { kind, text: kind === 'ok' ? 'Ready' : kind === 'warn' ? 'Check' : 'Not ready', notes };
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function renderReadiness() {
  const r = readiness();
  setBadge(el('diagReadyBadge'), r.kind, r.text);
  const list = el('diagReadyNotes');
  if (list) list.textContent = r.notes.join(' · ');
}

export function initDiagnostics() {
  const panel = el('setPanelDiag');
  if (!panel) return;

  // Readiness is derived from values the link already holds, so it costs a read
  // and is refreshed when the page is opened or the button is pressed — never
  // on a timer.
  el('diagReadyBtn')?.addEventListener('click', renderReadiness);

  // (The instrument stream went home to the sensor card — Ek, 2026-09-01.
  // ui-sygaldry's own paint covers it there; this page keeps its computed
  // judgements, which are the part that belongs to Diagnostics.)
  S._onSettingsPageShown = (id) => { if (id === 'diag') renderReadiness(); };

  el('diagScanBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = el('diagScanOut');
    if (!window.electronBridge?.wifiScan) {
      if (out) out.textContent = 'A WiFi survey needs the desktop app — a browser cannot scan.';
      return;
    }
    btn.disabled = true;
    setBadge(el('diagScanBadge'), 'warn', 'Scanning…');
    try {
      const r = await window.electronBridge.wifiScan();
      if (!r?.ok) { setBadge(el('diagScanBadge'), 'err', 'Failed');
                    if (out) out.textContent = r?.reason || 'scan failed'; return; }

      // Your own network is not interference — it is the link. Excluding it is
      // what stops the tool recommending you move away from yourself. The
      // instrument knows which one it is.
      const link = links().find((l) => l.connected);
      // The configured SSID only lands in state after a describe. Asking at
      // CONNECT time is what floods the send buffer (see the commit that added
      // sygaldry.js); asking once, here, on a press, is free.
      if (link && !link.latest('/describe/inputs/WiFi/ssid')) {
        try { link.describe(); await new Promise((r) => setTimeout(r, 900)); } catch (_) {}
      }
      const mine = link?.latest('/describe/inputs/WiFi/ssid')?.[0] ?? null;
      // macOS hands back "<redacted>" for every SSID unless the app has Location
      // Services. Channel and RSSI still come through, so the survey is useful
      // — but nothing can be matched by name, including your own network.
      const redacted = r.nets.length > 0 && r.nets.every((n) => /^<redacted>$/i.test(n.name));
      const others = redacted ? r.nets : r.nets.filter((n) => n.name !== mine);

      // Score each of the three non-overlapping channels by what sits within
      // two channels of it — a 20 MHz carrier is about that wide.
      const score = [1, 6, 11].map((ch) => {
        const on = others.filter((n) => Math.abs(n.ch - ch) <= 2);
        return { ch, count: on.length, strong: on.filter((n) => n.rssi > -70).length,
                 strongest: on.length ? Math.max(...on.map((n) => n.rssi)) : null };
      });
      const best = [...score].sort((a, b) =>
        a.strong - b.strong || (a.strongest ?? -100) - (b.strongest ?? -100))[0];
      setBadge(el('diagScanBadge'), 'ok', `Use channel ${best.ch}`);

      if (out) {
        const lines = score.map((c) =>
          `ch ${String(c.ch).padStart(2)} · ${c.count} nearby · ${c.strong} strong · `
          + `loudest ${c.strongest == null ? '—' : c.strongest + ' dBm'}`
          + (c.ch === best.ch ? '   ← pick this' : ''));
        const loud = others.filter((n) => n.rssi > -70)
          .map((n) => `  ch${String(n.ch).padStart(2)}  ${n.rssi} dBm  ${n.name}`);
        const own = mine ? r.nets.find((n) => n.name === mine) : null;
        out.textContent = lines.join('\n')
          + (own ? `\n\nyours: ${own.name} on ch${own.ch} at ${own.rssi} dBm`
                 + (![1, 6, 11].includes(own.ch)
                    ? `  — ch${own.ch} overlaps two of the three clear channels; move it to ${best.ch}`
                    : '')
             : redacted ? `\n\nmacOS is withholding the network names — every one came back as `
                    + `“<redacted>”, which is what it returns to an app without Location Services. `
                    + `Channels and signal strengths above are real and usable; only the names are `
                    + `missing, so your own network cannot be told apart from a neighbour's. Grant `
                    + `it in System Settings → Privacy & Security → Location Services to fix that.`
             : mine ? `\n\nyours: “${mine}” is not in this survey, though the instrument is joined `
                    + `to it. If SSID broadcast is on at the router, it should appear here.`
             : '')
          + (loud.length ? `\n\nloud neighbours:\n${loud.join('\n')}` : '')
          + `\n\n${others.length} other networks on 2.4 GHz. Set the channel on the router — `
          + `the instrument has one radio and follows whatever it joins.`;
      }
    } finally { btn.disabled = false; }
  });

  el('diagLinkBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = el('diagLinkOut');
    btn.disabled = true;
    setBadge(el('diagLinkBadge'), 'warn', 'Measuring…');
    try {
      const r = await measureLink(6);
      if (r.error) { setBadge(el('diagLinkBadge'), 'err', 'No reading');
                     if (out) out.textContent = r.error; return; }
      const [kind, label] = verdict(r.lostPct, r.stalls33);
      setBadge(el('diagLinkBadge'), kind, label);
      if (out) {
        out.textContent =
          `over ${r.via}\n`
          + `produced   ${r.produced == null ? '—' : r.produced.toFixed(1) + ' Hz'}\n`
          + `arriving   ${r.arriving.toFixed(1)} Hz\n`
          + `lost       ${r.lostPct.toFixed(1)}%\n`
          + `stalls     ${r.stalls33} over a frame · ${r.stalls100} over 100 ms\n`
          + `worst gap  ${r.max.toFixed(1)} ms   p99 ${r.p99.toFixed(1)} ms`;
      }
    } finally { btn.disabled = false; }
  });

  el('diagReportBtn')?.addEventListener('click', () => showDiagOverlay('diagnostics page'));
  el('diagCopyBtn')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(generateDiagReport('diagnostics page'));
      const b = e.currentTarget; const was = b.textContent;
      b.textContent = 'Copied'; setTimeout(() => { b.textContent = was; }, 1400);
    } catch (_) {}
  });

  renderReadiness();
}
