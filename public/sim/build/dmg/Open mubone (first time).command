#!/bin/bash
#
# Shipped inside the mubone DMG. Clears the quarantine flag macOS puts on
# anything downloaded, then launches the app. Needed because mubone carries an
# ad-hoc signature rather than an Apple Developer ID one — see READ ME FIRST.txt.

APP="/Applications/mubone.app"

echo
echo "  mubone — first launch helper"
echo

if [ ! -d "$APP" ]; then
  echo "  Can't find mubone in your Applications folder."
  echo "  Drag the mubone icon onto Applications first, then run this again."
  echo
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

echo "  Clearing the quarantine flag..."
if ! xattr -dr com.apple.quarantine "$APP" 2>/dev/null; then
  echo "  Couldn't clear it — the copy in Applications may belong to another"
  echo "  user account. Try: sudo xattr -dr com.apple.quarantine $APP"
  echo
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

echo "  Launching mubone..."
open "$APP"
echo
echo "  Done. You won't need this again for this version."
echo "  You can close this window."
echo
