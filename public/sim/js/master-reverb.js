// ============================================================================
// master-reverb.js — ONE reverb stage for everything that plays: an insert
// on every output channel, just before the ceiling (Ek, 2026-09-27)
//
//   speaker buses ─▶ merger ─▶ [reverb.worklet.js: one reverb per channel] ─▶ ceiling ─▶ interface
//   (loops, grains, cursor,         out[i] = in[i] + wet · reverb_i(in[i])
//    pinned clouds, dry)
//
// Whatever is spatialised to a speaker rings out on that speaker and stays
// there — "if it's on, anything that is spatialized there will reverb the
// amount i expect, loops, grains, cursor wet. i don't get why we need a
// separate cursor and tool-stroke reverb method." He was right: the separate
// paths came from a SEND, whose return lands back on the bus it was copied
// from and would feed itself. An insert copies nothing back, so one stage does
// it all. (The send came first, the same day: a live-input send, its tail at
// the cursor, then per speaker — git history, and docs/RULINGS.md.)
//
// Never recorded: takes come from the input, and this is the last stage of
// the output. The headphone pair is two more output channels, so the phones
// hear what the room hears.
//
// Controls: ON (the footer's VERB), AMOUNT, SPACE, TONE, FREEZE. On and freeze
// boot OFF, like the dry monitor; amount, space and tone persist. Off passes
// the audio straight through and lets a ringing tail finish; then every
// reverb idles. The DSP is js/reverb.js; SPACE and TONE are reverbFromKnobs.
//
// Wiring: audio.js asks for an insert with makeReverbInsert(actx, n, slot) and
// gets { input, output } at once — a straight wire until the worklet's module
// has loaded, then the worklet in between. Electron's slot is 'speakers' (the
// N-channel merger); the browser's is 'master' (the stereo master chain).
// ============================================================================

import { S, DEBUG } from './state.js';
import { reverbFromKnobs } from './reverb.js';

const LS_KEY = 'mubone_reverb';
const _module = new WeakMap();   // AudioContext → addModule promise
const _slots = new Map();        // slot → { node, ctx } — the live insert(s)
let _muted = false, _bypass = false;

// amount 0–1 → the wet level: squared, so the throw spends itself where a
// reverb is heard, and 1 is +6 dB of wet over the dry.
const _wet = a => 2 * a * a;

// ── Persistence: the dials, never on or freeze ──────────────────────────────
function _load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!d) return;
    for (const k of ['amount', 'space', 'tone']) if (Number.isFinite(d[k])) S.reverb[k] = Math.max(0, Math.min(1, d[k]));
  } catch (_) {}
}
function _save() {
  const { amount, space, tone } = S.reverb;
  try { localStorage.setItem(LS_KEY, JSON.stringify({ amount, space, tone })); } catch (_) {}
}

// ── State → the worklet(s) ──────────────────────────────────────────────────
function _post(node) {
  const R = S.reverb;
  // Freeze holds only while the reverb is ON. Frozen and then switched off,
  // the tail would otherwise never finish — a drone nothing on screen owns.
  node.port.postMessage({ params: { ...reverbFromKnobs(R), freeze: !!(R.freeze && R.on) }, on: !!R.on, wet: _wet(R.amount),
                          muted: _muted, bypass: _bypass });
}
function _apply() { for (const { node } of _slots.values()) if (node) _post(node); }

/** Change any of S.reverb's fields — the one setter; the footer, settings,
 *  actions and OSC all come through here. */
export function setReverb(patch) {
  const R = S.reverb;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in R)) continue;
    if (k === 'on' || k === 'freeze') { R[k] = !!v; continue; }
    const n = +v;
    if (!Number.isFinite(n)) continue;   // a NaN reached the buffers and never left (review)
    R[k] = Math.max(0, Math.min(1, n));
  }
  if (!R.on) R.freeze = false;   // off ends a freeze too: the switch means "no reverb now"
  _apply();
  if ('amount' in patch || 'space' in patch || 'tone' in patch) _saveSoon();
  _syncUI();
}

// A knob on MIDI or a sensor axis sends this dozens of times a second: the
// save and the diagram's redraw wait until it rests (main-thread work beside
// the 10 ms scheduler — RULINGS "Render path").
let _saveT = 0, _drawT = 0;
function _saveSoon() { clearTimeout(_saveT); _saveT = setTimeout(_save, 300); }
function _redrawSoon() { clearTimeout(_drawT); _drawT = setTimeout(() => S._redrawSignalPath?.(), 120); }

// ── The insert (called by audio.js) ─────────────────────────────────────────
/** An N-channel insert: { input, output }, a straight wire until the worklet
 *  lands. A new insert for a slot replaces the old one (a rebuilt speaker
 *  layout); the old one's ringing goes with it. */
export function makeReverbInsert(actx, n, slot) {
  const opts = { channelCount: n, channelCountMode: 'explicit', channelInterpretation: 'discrete' };
  const input = new GainNode(actx, opts), output = new GainNode(actx, opts);
  input.connect(output);   // bypass until the worklet is in
  const entry = { node: null, ctx: actx };
  // The insert this one replaces (a rebuilt speaker layout, a new context)
  // goes quiet and away — left running it kept processing, and its once-a-
  // second report fought the live one's for the load meter.
  const old = _slots.get(slot);
  if (old?.node) { try { old.node.port.postMessage({ stop: true }); old.node.port.onmessage = null; old.node.disconnect(); } catch (_) {} }
  if (old) S.reverbDiag = null;   // or the load bar keeps adding the dead one's share
  _slots.set(slot, entry);
  if (!_module.has(actx)) _module.set(actx, actx.audioWorklet.addModule('js/worklets/reverb.worklet.js'));
  _module.get(actx).then(() => {
    if (_slots.get(slot) !== entry) return;   // replaced meanwhile
    // A new insert starts with empty tails, and a freeze gates the input — so
    // a rebuild while frozen came up silent with freeze still shown on.
    if (S.reverb.freeze) setReverb({ freeze: false });
    const node = new AudioWorkletNode(actx, 'mubone-reverb', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [n], ...opts,
      processorOptions: { channels: n },
    });
    node.port.onmessage = e => { if (_slots.get(slot) === entry) S.reverbDiag = e.data; };
    _post(node);
    input.connect(node); node.connect(output);
    input.disconnect(output);
    entry.node = node;
    S._reverbNode = node; S._reverbIn = input;   // for the rig suite
    DEBUG && console.log(`[reverb] ${slot}: ${n} reverbs, one per channel`);
  }).catch(e => console.warn('[reverb] worklet:', e.message));
  return { input, output };
}

// ── The screen: the footer's VERB, the settings rows ────────────────────────
function _syncUI() {
  const R = S.reverb;
  const b = document.getElementById('tcReverb');
  if (b) { b.classList.toggle('is-mute', !R.on); b.setAttribute('aria-pressed', String(R.on)); }
  const pct = v => Math.round(v * 100) + '%';
  for (const [id, v] of [['reverbAmount', R.amount], ['reverbSpace', R.space], ['reverbTone', R.tone]]) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = String(v);
    const num = document.getElementById(id + 'Num');
    if (num) num.textContent = pct(v);
  }
  const fz = document.getElementById('reverbFreeze');
  if (fz) fz.checked = !!R.freeze;
  _redrawSoon();
}

function _wireUI() {
  document.getElementById('tcReverb')?.addEventListener('click', () => S._dispatchAction?.('reverb', 127));
  for (const [id, key] of [['reverbAmount', 'amount'], ['reverbSpace', 'space'], ['reverbTone', 'tone']]) {
    document.getElementById(id)?.addEventListener('input', e => setReverb({ [key]: +e.target.value }));
  }
  document.getElementById('reverbFreeze')?.addEventListener('change', e => setReverb({ freeze: e.target.checked }));
}

// MUTE silences the tails too. In Electron mute zeroes the speaker buses,
// which sit BEFORE this insert — so without this a tail rang on through a
// muted system. Cleared, not held: a muted rig carries nothing into unmute.
export function muteReverb(muted) {
  _muted = !!muted;
  for (const { node } of _slots.values()) node?.port.postMessage({ muted: _muted });
  // and a freeze with it, at mute and at unmute: frozen, the input is gated,
  // so the reverb would sit silent with the switch showing freeze on.
  if (S.reverb.freeze) setReverb({ freeze: false });
}

/** Dry only while the speaker sweep plays: a burst's tail on one speaker
 *  would muddle which speaker the next burst is. */
export function bypassReverb(on) {
  _bypass = !!on;
  for (const { node } of _slots.values()) node?.port.postMessage({ bypass: _bypass });
}

export function initMasterReverb() {
  _load();
  S._setReverb = setReverb;
  S._muteReverb = muteReverb;
  _wireUI();
  _syncUI();
}
