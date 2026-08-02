// ring-seize-test.js
//
// Throwaway test: does node-hid's default exclusive open on macOS prevent
// the OS from receiving HID events from a BLE ring?
//
// Usage:
//   node ring-seize-test.js                    # defaults to R2 (D01 Pro, VID 0x05ac PID 0x022c)
//   node ring-seize-test.js 0x05d6 0x022c      # test R1 (zhuhai_jieli)
//
// What to watch for while it runs:
//   - cursor stops responding to ring motion  → exclusive seize works (good)
//   - cursor still moves                       → seize is not blocking the OS
//   - hex bytes printed below                  → node-hid is reading the device

const HID = require('node-hid');

const VID = parseInt(process.argv[2] || '0x05ac', 16);
const PID = parseInt(process.argv[3] || '0x022c', 16);

console.log('node-hid version:', require('node-hid/package.json').version);
console.log(`looking for VID 0x${VID.toString(16).padStart(4,'0')} PID 0x${PID.toString(16).padStart(4,'0')}`);
console.log();

// Only seize pointing-device interfaces. Leave keyboard (usagePage=1, usage=6)
// and consumer-control (usagePage=12) interfaces free, so Karabiner can grab
// them and do its remap. Digitizer (usagePage=13) doesn't move the cursor on
// macOS anyway, so we don't need to seize it — but seizing it is harmless and
// gives us its data via node-hid.
//
// Pointing interfaces on usagePage=1 (Generic Desktop) are: usage=1 (Pointer),
// usage=2 (Mouse). Those are the ones that actually move the cursor.
function shouldSeize(d) {
  if (d.usagePage === 1 && (d.usage === 1 || d.usage === 2)) return true;  // mouse / pointer
  if (d.usagePage === 13) return true;                                      // digitizer
  return false;
}

const all = HID.devices();
const matches = all.filter(d => d.vendorId === VID && d.productId === PID && shouldSeize(d));

if (matches.length === 0) {
  console.error('No matching device found. Make sure the ring is paired and connected over Bluetooth.');
  console.error();
  console.error('All HID devices currently visible to node-hid:');
  all.forEach(d => {
    const v = '0x' + d.vendorId.toString(16).padStart(4,'0');
    const p = '0x' + d.productId.toString(16).padStart(4,'0');
    console.error(`  ${(d.manufacturer || '?').padEnd(20)} ${(d.product || '?').padEnd(30)} VID ${v} PID ${p} usage=${d.usage} usagePage=${d.usagePage}`);
  });
  process.exit(1);
}

console.log(`Found ${matches.length} HID interface(s) for this device:`);
matches.forEach(d => {
  console.log(`  product="${d.product}" usage=${d.usage} usagePage=${d.usagePage}`);
  console.log(`    path=${d.path}`);
});
console.log();
console.log('Opening all interfaces in exclusive (default) mode...');
console.log();

const devices = [];
for (const d of matches) {
  try {
    const h = new HID.HID(d.path);
    h.on('data', buf => {
      console.log(`  [usage=${d.usage}] ${buf.toString('hex')}`);
    });
    h.on('error', e => {
      console.error(`  [usage=${d.usage}] ERROR: ${e.message}`);
    });
    console.log(`  ok  usage=${d.usage} usagePage=${d.usagePage}`);
    devices.push(h);
  } catch (e) {
    console.error(`  err usage=${d.usage} usagePage=${d.usagePage}: ${e.message}`);
  }
}

console.log();
console.log('============================================================');
console.log(' NOW TEST: move the ring / press its buttons.');
console.log('   cursor stops moving  -> exclusive seize works');
console.log('   cursor keeps moving  -> seize did not block the OS');
console.log('   hex bytes below      -> node-hid is reading the ring');
console.log(' Ctrl-C to exit.');
console.log('============================================================');
console.log();

process.on('SIGINT', () => {
  console.log('\nClosing...');
  devices.forEach(h => { try { h.close(); } catch (_) {} });
  process.exit(0);
});
