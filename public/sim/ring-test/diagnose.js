// diagnose.js
//
// Single-shot diagnostic: dumps everything we'd want to know about why
// ring-bridge.js can't open R1, into ./diag.log so it can be read directly.
//
// Run:
//   node diagnose.js
//
// Then share /Users/kalun/Documents/GitHub/muboneapp/ring-test/diag.log

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const HID  = require('node-hid');

const VID = 0x05d6;
const PID = 0x022c;
const LOG = path.join(__dirname, 'diag.log');

// Replace existing log
fs.writeFileSync(LOG, '');

function log(s) {
  fs.appendFileSync(LOG, s + '\n');
  console.log(s);
}

function header(s) {
  log('');
  log('='.repeat(70));
  log(' ' + s);
  log('='.repeat(70));
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return `[ERROR running '${cmd}']: ${e.message}\n${e.stderr || ''}`;
  }
}

log(`diagnose.js — ${new Date().toISOString()}`);
log(`looking for VID=0x${VID.toString(16)} PID=0x${PID.toString(16)} (R1)`);

// ── 1. environment ────────────────────────────────────────────────────────────

header('1. environment');
log('node version:         ' + process.version);
log('node-hid version:     ' + require('node-hid/package.json').version);
log('platform:             ' + process.platform + ' ' + process.arch);
log('macOS version:        ' + sh('sw_vers -productVersion'));
log('shell pid:            ' + process.pid);
log('script cwd:           ' + process.cwd());

// ── 2. processes that might be grabbing HID ───────────────────────────────────

header('2. potential grabber processes');
log('-- karabiner / hammerspoon / hid daemons --');
log(sh("ps aux | grep -iE 'karabiner|hammerspoon|hidd|virtualhid|node' | grep -v grep") || '(none)');
log('');
log('-- launchd daemons matching karabiner --');
log(sh("launchctl list | grep -iE 'karabiner|hammerspoon|pqrs'") || '(none)');
log('');
log('-- other node processes (could be lingering ring-seize-test) --');
log(sh("pgrep -fl 'node ' | grep -v 'diagnose.js'") || '(none)');

// ── 3. bluetooth state for R1 ─────────────────────────────────────────────────

header('3. bluetooth state');
const btJson = sh('system_profiler SPBluetoothDataType -json 2>/dev/null');
try {
  const bt = JSON.parse(btJson);
  const items = JSON.stringify(bt, null, 2);
  // Slice anything around "R1" so we don't dump the whole report
  const idx = items.search(/R1\b/);
  if (idx >= 0) {
    log(items.slice(Math.max(0, idx - 400), idx + 800));
  } else {
    log('(no "R1" name found in bluetooth report — device may not be paired or named differently)');
  }
} catch (e) {
  log('[ERROR parsing system_profiler]: ' + e.message);
  log(btJson.slice(0, 2000));
}

// ── 4. hidutil current remap state for R1 ─────────────────────────────────────

header('4. hidutil state for R1');
log(sh(`hidutil property --matching '{"VendorID":${VID},"ProductID":${PID}}' --get UserKeyMapping`));

// ── 5. enumerate all HID devices ──────────────────────────────────────────────

header('5. HID enumeration (full)');
const all = HID.devices();
log(`total HID devices visible to node-hid: ${all.length}`);
all.forEach((d, i) => {
  const v = '0x' + d.vendorId.toString(16).padStart(4, '0');
  const p = '0x' + d.productId.toString(16).padStart(4, '0');
  log(`  [${i}] ${(d.manufacturer || '?').slice(0,20).padEnd(20)} ${(d.product || '?').slice(0,32).padEnd(32)} VID=${v} PID=${p} usage=${d.usage} usagePage=${d.usagePage} path=${d.path}`);
});

// ── 6. R1-specific interfaces and open-attempt per interface ──────────────────

header('6. R1 interfaces — attempt to open each');
const r1 = all.filter(d => d.vendorId === VID && d.productId === PID);
log(`matching interfaces: ${r1.length}`);

if (r1.length === 0) {
  log('R1 not visible to node-hid. Confirm Bluetooth pairing + connection.');
} else {
  for (const d of r1) {
    log('');
    log(`-- usage=${d.usage} usagePage=${d.usagePage} path=${d.path} --`);
    log(`   product="${d.product}" manufacturer="${d.manufacturer}" interface=${d.interface} serialNumber="${d.serialNumber || ''}"`);
    // Try exclusive (default) first
    let opened = null;
    let openedMode = null;
    try {
      opened = new HID.HID(d.path);
      openedMode = 'exclusive';
      log(`   ✓ exclusive open succeeded`);
    } catch (eExclusive) {
      log(`   ✗ exclusive open failed: ${eExclusive.message}`);
      // Fall back to non-exclusive (passive observer) — needs node-hid >= 3.2.0
      try {
        opened = new HID.HID(d.path, { nonExclusive: true });
        openedMode = 'nonExclusive';
        log(`   ✓ NON-exclusive open succeeded (something else has it exclusively)`);
      } catch (eNonExclusive) {
        log(`   ✗ non-exclusive open ALSO failed: ${eNonExclusive.message}`);
      }
    }

    if (opened) {
      let dataCount = 0;
      opened.on('data', buf => { dataCount++; if (dataCount <= 3) log(`   data[${dataCount}]: ${buf.toString('hex')}`); });
      opened.on('error', e => log(`   runtime error: ${e.message}`));
      setTimeout(() => {
        log(`   data events received in ~50ms (${openedMode}): ${dataCount}`);
        try { opened.close(); log('   closed'); } catch (e) { log('   close error: ' + e.message); }
      }, 50);
    }
  }
}

// ── 7. give async listeners a moment, then summarize and exit ─────────────────

setTimeout(() => {
  header('7. summary');
  log(`log written to: ${LOG}`);
  log('share that file with me to diagnose the open failures.');
  log('');
  log('done.');
  process.exit(0);
}, 500);
