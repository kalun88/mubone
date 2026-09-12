/**
 * electron-builder afterPack hook — runs after the .app is packed, before the DMG
 * is built. Two steps, and the order is the whole point:
 *
 *   1. fix-audify-rpath — rewrite audify.node's @rpath references to @loader_path
 *   2. ad-hoc codesign  — sign the bundle with the "-" (ad-hoc) identity
 *
 * install_name_tool rewrites Mach-O load commands, which invalidates whatever
 * signature the binary was carrying. So signing has to come second, or it signs
 * a binary that is about to be edited.
 *
 * Why sign at all with no Apple Developer ID: on Apple Silicon the kernel will
 * not execute an arm64 binary that carries no signature whatsoever. Electron
 * ships its own binaries ad-hoc signed; packing the app (asar, plist edits, the
 * rpath patch above) breaks those seals, and `mac.identity: null` in
 * package.json tells electron-builder not to re-sign. Without this step the app
 * can die at launch with a code-signature error and no useful dialog.
 *
 * An ad-hoc signature is free and needs no Apple account. It does NOT satisfy
 * Gatekeeper — a collaborator's first launch still has to clear the quarantine
 * flag (see build/dmg/ and INSTALL.md). It only makes the binary loadable.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const fixAudifyRpath = require('./fix-audify-rpath');

// Nested Mach-O files that live outside the app's own code directories — these
// are not sealed as code by --deep, so they get signed individually first.
function nestedBinaries(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) nestedBinaries(p, found);
    else if (/\.(node|dylib)$/.test(entry.name)) found.push(p);
  }
  return found;
}

// index.html is packed into app.asar, but its stylesheets and scripts only get
// packed if build.files says so. A file the page references and the archive lacks
// costs nothing at build time and produces a running app with no styling — which
// is exactly how css/tokens.css shipped missing once. Check the packed archive,
// not the source tree: the source always has the file.
function checkPackedAssets(appPath, projectDir) {
  const asar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (!fs.existsSync(asar)) return;

  const fd = fs.openSync(asar, 'r');
  let index;
  try {
    const sizeBuf = Buffer.alloc(16);
    fs.readSync(fd, sizeBuf, 0, 16, 0);
    const headerSize = sizeBuf.readUInt32LE(12);
    const header = Buffer.alloc(headerSize);
    fs.readSync(fd, header, 0, headerSize, 16);
    index = JSON.parse(header.toString('utf8').replace(/\0+$/, ''));
  } finally {
    fs.closeSync(fd);
  }

  const isPacked = (relPath) => {
    let node = index;
    for (const part of relPath.split('/')) {
      if (!node.files || !node.files[part]) return false;
      node = node.files[part];
    }
    return true;
  };

  const html = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const refs = [...new Set(
    [...html.matchAll(/(?:href|src)="([^":]+)"/g)]
      .map(m => m[1])
      .filter(r => r && !r.startsWith('#') && !r.startsWith('/'))
  )];

  const missing = refs.filter(r => !isPacked(r));
  if (missing.length) {
    throw new Error(
      `index.html references ${missing.length} file(s) that are not in app.asar:\n  ` +
      missing.join('\n  ') +
      `\nAdd them to "build.files" in package.json.`
    );
  }
  console.log(`[check-assets] ✓ all ${refs.length} index.html references are packed`);
}

function sign(target, extraArgs = []) {
  execFileSync('codesign', ['--force', '--sign', '-', ...extraArgs, target], { stdio: 'pipe' });
}

module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') return; // macOS only

  await fixAudifyRpath(context);

  const appPath = path.join(context.appOutDir,
                            `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    console.log('[adhoc-sign] app bundle not found — skipping');
    return;
  }

  checkPackedAssets(appPath, context.packager.info.projectDir);

  const unpacked = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
  const binaries = nestedBinaries(unpacked);
  console.log(`[adhoc-sign] signing ${binaries.length} unpacked native binaries`);
  for (const bin of binaries) {
    try {
      sign(bin);
    } catch (e) {
      console.error(`  ✗ ${path.relative(appPath, bin)}: ${e.stderr?.toString().trim() || e.message}`);
    }
  }

  console.log('[adhoc-sign] signing the app bundle (ad-hoc identity)');
  try {
    // --deep re-signs the Electron framework and the helper apps too. Deprecated
    // for real distribution signing, but it is the right tool for sealing a
    // bundle nobody is going to notarize.
    sign(appPath, ['--deep']);
  } catch (e) {
    console.error(`[adhoc-sign] FAILED: ${e.stderr?.toString().trim() || e.message}`);
    throw e; // a build that ships an unlaunchable app is worse than no build
  }

  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log('[adhoc-sign] ✓ signature verifies');
  } catch (e) {
    console.error(`[adhoc-sign] verification failed: ${e.stderr?.toString().trim() || e.message}`);
    throw e;
  }

  // The DMG helper is copied into the disk image straight from build/dmg/, and a
  // .command file only double-clicks if it is executable. Set it here rather than
  // relying on the mode git happened to record.
  const helper = path.join(context.packager.info.projectDir, 'build', 'dmg',
                           'Open mubone (first time).command');
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
};

// Exposed so the check can be exercised against an already-packed app:
//   node -e "require('./build/after-pack.js').checkPackedAssets('dist/mac-arm64/mubone.app', process.cwd())"
module.exports.checkPackedAssets = checkPackedAssets;
