// ============================================================================
// status-publisher.js — push a small set of app state flags to /status/*
//
// Edge-triggered on the wire: polls a tiny watchlist at 20 Hz, diffs against
// the last sent value, only emits on change. A stable state produces zero
// network traffic. This keeps the downstream joycon GUI from choking BLE HID
// on bursts of redundant state.
//
// On `osc-connected` the full set is force-resent once so a late-joining peer
// (joycon reload, relay restart, etc.) lights up correctly.
//
// What's on the wire (tailored to the joycon feedback consumer):
//   /status/trace          — trace armed, hands-free OFF
//   /status/trace/hf       — trace armed, hands-free ON
//   /status/slots/filled   — integer 0..MAX_COMMITS: raw count of occupied
//                            commit slots. The consumer does all the gauge
//                            math (N-LED fill, near-full, full), so this
//                            wire value is deliberately plain — one integer,
//                            no pre-bucketing, no derived flags.
//   /status/slots/max      — integer 1..MAX_COMMITS: current session limit
//                            (`S.commitSlotCount`), user-adjustable during a
//                            session. Consumer gauges "full" against this,
//                            not the hard cap.
// ============================================================================

import { S } from './state.js';
import { sendOSC } from './osc.js';

const STATUS_TICK_MS = 50;  // 20 Hz change detection

function _slotsFilled() {
  const arr = S.commitSlots;
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]) n++;
  return n;
}

// ── The wire contract — each entry is one /status/<x> address on the wire ──
const WATCH = [
  { addr: '/status/trace',        get: () =>
      ((S._traceToggled || S.isPainting) && !S.hfArmed) ? 1 : 0 },
  { addr: '/status/trace/hf',     get: () =>
      ((S._traceToggled || S.isPainting) &&  S.hfArmed) ? 1 : 0 },
  { addr: '/status/slots/filled', get: () => _slotsFilled() },
  { addr: '/status/slots/max',    get: () => Math.max(1, Math.min(16, S.commitSlotCount | 0)) },
];

const _last = new Map();
let _tickTimer = null;
let _started   = false;

function readAndSend(force) {
  for (const w of WATCH) {
    let v;
    try { v = w.get(); } catch (_) { continue; }
    if (v === undefined || v === null) continue;
    if (!force && _last.get(w.addr) === v) continue;
    _last.set(w.addr, v);
    sendOSC(w.addr, [v]);
  }
}

export function initStatusPublisher() {
  if (_started) return;
  _started = true;
  _tickTimer = setInterval(() => readAndSend(false), STATUS_TICK_MS);

  if (typeof window !== 'undefined') {
    // Force-resync once when the transport connects so a peer that started
    // late (joycon GUI reloaded, relay just came up) sees current state.
    window.addEventListener('osc-connected',    () => { _last.clear(); readAndSend(true); });
    window.addEventListener('osc-disconnected', () => { _last.clear(); });
  }
}

export function stopStatusPublisher() {
  _started = false;
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  _last.clear();
}
