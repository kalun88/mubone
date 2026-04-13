/**
 * electron-builder afterPack hook
 *
 * audify.node links librtaudio and libopus via @rpath, which doesn't resolve
 * when the binary is loaded from app.asar.unpacked. This hook rewrites the
 * references to @loader_path so the dynamic linker finds the dylibs in the
 * same directory as audify.node (build/Release/).
 *
 * Runs automatically after electron-builder packs the app but before the
 * installer/dmg is created.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') return; // macOS only

  const appOutDir = context.appOutDir;
  const resourcesDir = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`,
                                  'Contents', 'Resources');
  const releaseDir = path.join(resourcesDir, 'app.asar.unpacked',
                               'node_modules', 'audify', 'build', 'Release');
  const nodeFile = path.join(releaseDir, 'audify.node');

  if (!fs.existsSync(nodeFile)) {
    console.log('[fix-audify-rpath] audify.node not found in unpacked — skipping');
    return;
  }

  console.log('[fix-audify-rpath] patching audify.node dylib references: @rpath → @loader_path');

  const patches = [
    { old: '@rpath/libopus.0.dylib',    new: '@loader_path/libopus.0.dylib' },
    { old: '@rpath/librtaudio.8.dylib',  new: '@loader_path/librtaudio.8.dylib' },
  ];

  for (const p of patches) {
    try {
      execSync(`install_name_tool -change "${p.old}" "${p.new}" "${nodeFile}"`, { stdio: 'pipe' });
      console.log(`  ✓ ${p.old} → ${p.new}`);
    } catch (e) {
      console.error(`  ✗ failed to patch ${p.old}: ${e.message}`);
    }
  }

  // Verify
  try {
    const out = execSync(`otool -L "${nodeFile}"`, { encoding: 'utf8' });
    console.log('[fix-audify-rpath] final otool -L:');
    console.log(out);
  } catch (_) {}
};
