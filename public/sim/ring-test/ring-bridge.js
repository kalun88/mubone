// ring-bridge.js
//
// One terminal command that does the whole ring → mubone chain:
//   1. Remaps R1's volume keys to inert F-keys at the kernel level (hidutil)
//      so macOS doesn't change system volume when you do hold gestures.
//      Scoped to R1 only — your laptop's volume keys still work.
//   2. Reads R1 raw HID via node-hid (digitizer, mouse, keyboard, consumer).
//   3. Decodes flips, taps, and hold gestures.
//   4. Emits OSC over UDP to mubone (default 127.0.0.1:7500 = Electron port).
//   5. On Ctrl-C, clears the hidutil remap so the system goes back to normal.
//
// Replaces: Karabiner-Elements + Hammerspoon + Max [hi] for ring input.
//
// Run:
//   cd ~/Documents/GitHub/muboneapp/ring-test
//   node ring-bridge.js                       # default OSC to 127.0.0.1:7500
//   OSC_HOST=127.0.0.1 OSC_PORT=8000 node ring-bridge.js
//
// Stop: Ctrl-C  (clears hidutil mapping; system volume keys work again)
//
// Requirements: node-hid (already in package.json), macOS Big Sur or newer
// (older macOS may not support consumer-page sources in hidutil's UserKeyMapping).

const HID    = require('node-hid');
const dgram  = require('dgram');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const VID = 0x05d6;
const PID = 0x022c;
const OSC_HOST = process.env.OSC_HOST || '127.0.0.1';
const OSC_PORT = parseInt(process.env.OSC_PORT || '7500', 10);
const DEBUG_BYTES = process.env.DEBUG_BYTES === '1';
const LOG_PATH = path.join(__dirname, 'bridge.log');
if (DEBUG_BYTES) fs.writeFileSync(LOG_PATH, `bridge.log — ${new Date().toISOString()}\n`);
function dlog(line) {
  if (!DEBUG_BYTES) return;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

// ── hidutil: kernel-level volume-key suppression for R1 only ──────────────────
// HIDKeyboardModifierMapping values are (UsagePage << 32) | Usage.
//   Consumer page 0x0C, VolumeIncrement 0xE9 → 0xC000000E9
//   Keyboard page 0x07, F19 0x6E              → 0x70000006E
// Remapping VolumeUp/Down/Mute to F19/F20/F21 means macOS never sees a media
// key (no volume HUD, no system volume change) but node-hid still reads the
// original consumer reports below the remap layer.

function hidutilSet(mapping) {
  const matching = JSON.stringify({ VendorID: VID, ProductID: PID });
  const cmd = `hidutil property --matching '${matching}' --set '${mapping}'`;
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error('[hidutil]', e.stderr ? e.stderr.toString().trim() : e.message);
    return false;
  }
}

function applyVolumeRemap() {
  const map = JSON.stringify({
    UserKeyMapping: [
      { HIDKeyboardModifierMappingSrc: 0xC000000E9, HIDKeyboardModifierMappingDst: 0x70000006E }, // VolUp  -> F19
      { HIDKeyboardModifierMappingSrc: 0xC000000EA, HIDKeyboardModifierMappingDst: 0x70000006F }, // VolDn  -> F20
      { HIDKeyboardModifierMappingSrc: 0xC000000E2, HIDKeyboardModifierMappingDst: 0x700000070 }, // Mute   -> F21
    ]
  });
  if (hidutilSet(map)) console.log('[hidutil] volume → F19/F20/F21 (this device only)');
  else console.log('[hidutil] remap failed; system volume may change on hold gestures');
}

function clearVolumeRemap() {
  hidutilSet(JSON.stringify({ UserKeyMapping: [] }));
  console.log('[hidutil] remap cleared');
}

// ── OSC encoder (UDP, no bundles, int + float typed) ──────────────────────────

const sock = dgram.createSocket('udp4');

function padStr(s) {
  const raw = Buffer.from(s + '\0', 'utf8');
  const buf = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0);
  raw.copy(buf);
  return buf;
}

function osc(address, ...values) {
  const types = values.map(v => Number.isInteger(v) ? 'i' : 'f').join('');
  const args = values.map((v, i) => {
    const b = Buffer.alloc(4);
    if (types[i] === 'i') b.writeInt32BE(v, 0);
    else                  b.writeFloatBE(v, 0);
    return b;
  });
  const pkt = Buffer.concat([padStr(address), padStr(',' + types), ...args]);
  sock.send(pkt, 0, pkt.length, OSC_PORT, OSC_HOST);
}

// ── HID decode ────────────────────────────────────────────────────────────────

let strokeSamples = [];  // x/y samples accumulated during current digitizer stroke
let strokeClassified = false;  // have we already emitted the OSC for this stroke?
let lastStrokeTimestamp = 0;   // for suppressing consumer-event noise during/just-after a stroke
const STROKE_GRACE_MS = 150;   // consumer events ignored if stroke is active or ended < this ago

// Hold detection. Any input "ticks" call noteEvent(name). The first tick of a
// burst raises <name>_held=1; after 300ms with no further ticks of the same
// name, it falls to 0. Per-input tap events fire normally too.
const HELD_GAP_MS = 300;
const holdTimers = {};
const holdState  = {};
function noteEvent(name) {
  if (holdTimers[name]) clearTimeout(holdTimers[name]);
  if (!holdState[name]) {
    holdState[name] = true;
    osc(`/sensor/ring/${name}_held`, 1);
    console.log(`  ${name}_held: 1`);
  }
  holdTimers[name] = setTimeout(() => {
    holdState[name] = false;
    holdTimers[name] = null;
    osc(`/sensor/ring/${name}_held`, 0);
    console.log(`  ${name}_held: 0`);
  }, HELD_GAP_MS);
}

// All 6 HID interface paths point to the same underlying device on macOS,
// so we only open one handle and dispatch by report ID inside the data handler.
function decode(d, buf) {
  if (DEBUG_BYTES) {
    dlog(`len=${buf.length} hex=${buf.toString('hex')}`);
  }
  const reportId = buf[0];
  if (reportId === 0x02)      return decodeDigitizer(buf);
  else if (reportId === 0x04) return decodeConsumer(buf);
  else if (reportId === 0x05) return decodeMouse(buf);
  // Other report IDs (e.g. keyboard reports for remapped F-keys) are silent.
}

function decodeDigitizer(buf) {
  // Verified layout (6 bytes total):
  //   buf[0]   = 0x02  (report id)
  //   buf[1]   = packed flags. Bit 4 = TipSwitch, bit 0 = ContactId(?)
  //   buf[2-3] = X (16-bit little-endian)
  //   buf[4-5] = Y (16-bit little-endian)
  if (buf.length < 6) return;
  const tip = (buf[1] & 0x10) !== 0;
  const x   = buf.readUInt16LE(2);
  const y   = buf.readUInt16LE(4);

  if (tip) {
    lastStrokeTimestamp = Date.now();
    strokeSamples.push({ x, y });
    // Try to classify and emit ASAP, but only after we have >= 2 samples
    // so we can determine trend rather than relying on the first sample.
    if (!strokeClassified && strokeSamples.length >= 2) {
      const dir = classifyStroke(strokeSamples);
      if (dir && dir !== 'btn_bottom') {  // hold btn_bottom for release-side detection
        emitFlip(dir);
        strokeClassified = true;
      }
    }
  } else {
    // Stroke released. If we never classified (e.g. a center tap that's only one sample),
    // try once more on the released stroke.
    if (!strokeClassified && strokeSamples.length >= 1) {
      const dir = classifyStroke(strokeSamples);
      if (dir) emitFlip(dir);
    }
    strokeSamples = [];
    strokeClassified = false;
  }
}

function classifyStroke(samples) {
  // Center tap: every sample sits at the exact center anchor for both axes.
  if (samples.every(s => s.x === 1022 && s.y === 1022)) return 'btn_bottom';

  // Determine which axis is "the fixed anchor" by checking variance.
  // Vertical flip: X stays at 1022 (within tolerance), Y sweeps.
  // Horizontal flip: Y stays at 681 (within tolerance), X sweeps.
  const TOL = 50;
  const xFixedAt1022 = samples.every(s => Math.abs(s.x - 1022) < TOL);
  const yFixedAt681  = samples.every(s => Math.abs(s.y - 681)  < TOL);

  // Classify by net trend across the whole burst (robust to dropped first sample)
  if (xFixedAt1022 && samples.length >= 2) {
    const first = samples[0], last = samples[samples.length - 1];
    return last.y > first.y ? 'top' : 'bottom';
  }
  if (yFixedAt681 && samples.length >= 2) {
    const first = samples[0], last = samples[samples.length - 1];
    return last.x > first.x ? 'left' : 'right';
  }
  return null;  // not enough info yet
}

function emitFlip(dir) {
  if (dir === 'btn_bottom') {
    osc('/sensor/ring/btn_bottom', 1);
    console.log('btn_bottom: tap');
    noteEvent('btn_bottom');
  } else {
    osc('/sensor/ring/flip', dir);
    console.log(`flip: ${dir}`);
    noteEvent(`flip_${dir}`);
  }
}

// Consumer report 0x04 — bit-packed.
//   bit 0 (0x01) — emitted by both: TOP BUTTON TAP (1 cycle) AND RIGHT FLIP HOLD (many cycles)
//   bit 1 (0x02) — emitted by:      LEFT FLIP HOLD  (many cycles)
//   bit 3 (0x08) — emitted by:      TOP BUTTON HOLD (1 cycle) — also changes ring's firmware mode
//
// Disambiguation: count cycles within a 350ms window. 1 isolated cycle = tap.
// 2+ cycles = hold-of-flip.
const TAP_VS_HOLD_WINDOW_MS = 350;

let consumerState = 0;
const bitTracker = {
  0x01: { cycles: 0, decideTimer: null, holdName: 'flip_right_held', tapName: 'btn_top'      },
  0x02: { cycles: 0, decideTimer: null, holdName: 'flip_left_held',  tapName: null            },
  0x08: { cycles: 0, decideTimer: null, holdName: null,              tapName: 'btn_top_hold'  },
};

function decodeConsumer(buf) {
  if (buf.length < 2) return;
  // Suppress consumer noise that fires alongside digitizer strokes (top/bottom
  // flip holds emit digitizer streams; the firmware sometimes also emits
  // consumer events at the start that aren't real button presses).
  if (Date.now() - lastStrokeTimestamp < STROKE_GRACE_MS) return;

  const cur = buf[1];
  for (const mask of [0x01, 0x02, 0x08]) {
    const wasDown = (consumerState & mask) !== 0;
    const isDown  = (cur            & mask) !== 0;
    if (isDown && !wasDown) {
      handleConsumerRisingEdge(mask);
    }
  }
  consumerState = cur;
}

function handleConsumerRisingEdge(mask) {
  const t = bitTracker[mask];
  t.cycles += 1;

  if (t.cycles === 1) {
    // First cycle — could be a tap, or could be the start of a hold burst.
    // Schedule a decision: if no more cycles arrive in TAP_VS_HOLD_WINDOW_MS,
    // it was an isolated tap. Otherwise more cycles will roll in and convert it.
    if (t.decideTimer) clearTimeout(t.decideTimer);
    t.decideTimer = setTimeout(() => {
      if (t.cycles === 1 && t.tapName) {
        // Isolated tap confirmed.
        osc(`/sensor/ring/${t.tapName}`, 1);
        osc(`/sensor/ring/${t.tapName}`, 0);
        console.log(`${t.tapName}: tap`);
        if (t.tapName === 'btn_top_hold') {
          console.log('  ⚠ btn_top_hold also triggered a ring-firmware MODE CHANGE — subsequent gestures may behave differently');
        }
        noteEvent(t.tapName);
      }
      t.cycles = 0;
      t.decideTimer = null;
    }, TAP_VS_HOLD_WINDOW_MS);
  } else if (t.cycles === 2 && t.holdName) {
    // Second cycle within the window — this is a hold burst, not a tap.
    // Cancel the pending tap decision and switch to hold mode.
    if (t.decideTimer) { clearTimeout(t.decideTimer); t.decideTimer = null; }
    noteEvent(t.holdName);
    // Schedule reset of cycle counter after the burst fully ends.
    t.decideTimer = setTimeout(() => {
      t.cycles = 0;
      t.decideTimer = null;
    }, TAP_VS_HOLD_WINDOW_MS);
  } else if (t.cycles > 2 && t.holdName) {
    // Continuing a hold burst — refresh held timer.
    noteEvent(t.holdName);
    if (t.decideTimer) clearTimeout(t.decideTimer);
    t.decideTimer = setTimeout(() => {
      t.cycles = 0;
      t.decideTimer = null;
    }, TAP_VS_HOLD_WINDOW_MS);
  }
}

function decodeMouse(buf) {
  // Mouse mode: [reportId=4, button bitfield, ...] for buttons,
  //             [reportId=5, dx_lo, dx_hi, dy_lo, dy_hi] for motion.
  // node-hid exclusive open keeps the macOS cursor frozen, so this is safe.
  if (buf[0] === 5 && buf.length >= 5) {
    const dx = buf.readInt16LE(1);
    const dy = buf.readInt16LE(3);
    if (dx || dy) osc('/sensor/ring/mouse', dx, dy);
  } else if (buf[0] === 4) {
    const btn = buf[1] || 0;
    osc('/sensor/ring/mouse_btn', btn);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

applyVolumeRemap();

const ifaces = HID.devices().filter(d => d.vendorId === VID && d.productId === PID);
if (ifaces.length === 0) {
  console.error('R1 not found. Make sure it is paired and connected.');
  clearVolumeRemap();
  process.exit(1);
}

// Non-exclusive open — passive observer mode.
// macOS binds a system driver to R1 because BT classifies it as a mouse, which
// blocks exclusive grab. Non-exclusive still gets us every HID report.
// Trade-off: if R1 is switched into mouse mode, the cursor will respond to it
// (we are not blocking the OS driver). For digitizer mode (iOS default), the
// cursor doesn't react to digitizer reports anyway, so this is fine.
// All 6 R1 interfaces share one underlying device path on macOS — opening any
// one of them streams every report from the device. Opening multiple just
// duplicates events and creates noise. Open one, dispatch by report id.
const opened = [];
const single = ifaces[0];
try {
  const h = new HID.HID(single.path, { nonExclusive: true });
  h.on('data',  buf => decode(single, buf));
  h.on('error', e   => console.error(`HID error: ${e.message}`));
  opened.push(h);
  console.log(`opened (single handle for all R1 reports) path=${single.path}`);
} catch (e) {
  console.error(`open failed: ${e.message}`);
  clearVolumeRemap();
  process.exit(1);
}

console.log(`\nOSC → udp://${OSC_HOST}:${OSC_PORT}`);
console.log('Ctrl-C to stop (will undo hidutil remap).\n');

function shutdown() {
  console.log('\nshutting down...');
  for (const h of opened) { try { h.close(); } catch (_) {} }
  clearVolumeRemap();
  sock.close();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
