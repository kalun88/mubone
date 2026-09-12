#!/usr/bin/env bash
# ============================================================================
# build-share.command — double-click to build the Apple Silicon DMG you send
# to collaborators. No terminal typing needed.
#
# Runs `electron-builder --mac --arm64`, which packs the app, patches audify's
# dylib paths and ad-hoc codesigns the bundle (build/after-pack.js), then
# builds the disk image with the app, an Applications shortcut, READ ME
# FIRST.txt and the first-launch helper in it.
#
# Deliberately does NOT run `npm install`. electron-builder builds against
# whatever Electron is in node_modules, and audify is compiled for that exact
# ABI — reinstalling right before a release means rebuilding native modules and
# re-testing the app. Do that on purpose, not on the way to a share.
#
# The result is unsigned as far as Apple is concerned: recipients still do the
# one-time unblock described in READ ME FIRST.txt.
# ============================================================================

set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

if [ ! -d node_modules ]; then
  echo "❌ node_modules/ is missing. Run 'npm install && npm run rebuild' first."
  echo ""
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
ELECTRON=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo "?")

echo "============================================================"
echo " mubone $VERSION  →  arm64 DMG"
echo " building against Electron $ELECTRON"
echo "============================================================"
echo ""

npm run dist:arm64
STATUS=$?

echo ""
if [ $STATUS -ne 0 ]; then
  echo "❌ Build failed (exit $STATUS). The error is above."
  echo "   Common cause: audify was compiled for a different Electron ABI —"
  echo "   'npm run rebuild' fixes that, then run this again."
  echo ""
  read -n 1 -s -r -p "Press any key to close…"
  exit $STATUS
fi

DMG=$(ls -t dist/*-arm64.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "⚠️  Build reported success but no arm64 DMG turned up in dist/."
  echo ""
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

SIZE=$(du -h "$DMG" | cut -f1)
echo "✅ $DMG  ($SIZE)"
echo ""
echo "   Signature check on the packed app:"
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/mubone.app" 2>&1 | sed 's/^/   /'
echo ""
echo "   Send the .dmg. Tell them to read READ ME FIRST.txt inside it —"
echo "   macOS blocks the first launch until they clear the quarantine flag."

open -R "$DMG"
sleep 3
