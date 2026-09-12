#!/bin/sh
# worktree-setup.sh — make a fresh git worktree able to run the audits.
#
# `claude --worktree <name>` checks the repo out again under .claude/worktrees/<name>
# with no node_modules, so the first rig suite there fails at "electron not found".
# Run this once inside the worktree: it links node_modules (and the dev certs, if
# the main checkout has them) from the main checkout instead of installing again.
#
#   sh scripts/worktree-setup.sh
#
# Then run suites with their own instance and port so they cannot collide with a
# session in the main checkout (docs/AUDITS.md § 1):
#
#   MUBONE_RIG_INSTANCE=<name> MUBONE_RIG_PORT=7598 node scripts/audit-for.js --run
set -e
HERE=$(git rev-parse --show-toplevel)
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
if [ "$HERE" = "$MAIN" ]; then echo "this is the main checkout — nothing to link"; exit 0; fi
[ -e "$HERE/node_modules" ] || ln -s "$MAIN/node_modules" "$HERE/node_modules"
for f in localhost.pem localhost-key.pem; do
  [ -e "$HERE/$f" ] || [ ! -e "$MAIN/$f" ] || ln -s "$MAIN/$f" "$HERE/$f"
done
NAME=$(basename "$HERE")
echo "linked node_modules from $MAIN"
echo "audits here:  MUBONE_RIG_INSTANCE=$NAME MUBONE_RIG_PORT=7598 node scripts/audit-for.js --run"
