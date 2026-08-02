#!/usr/bin/env bash
# ============================================================================
# launch-stations.command — double-click to start the multi-station setup
# from the INSTALLED mubone.app (no terminal, no dev checkout needed).
#
# Why this file exists: macOS won't start a second copy of an app when you
# double-click it — Launch Services just activates the running one. `open -n`
# forces a genuinely new process, and `--args` passes the instance flags
# through to Electron.
#
# Each station gets its own settings profile and OSC listen port:
#   a → 7500    b → 7510    c → 7520   (…d 7530, up to i)
#
# To change how many stations launch, edit COUNT below.
# Keep a copy on the Desktop for one-click show setup — it works from
# anywhere, it doesn't need to live next to the app.
# ============================================================================

COUNT=3        # ← number of stations to launch (1–9)

# Find the installed app
APP=""
for candidate in "/Applications/mubone.app" "$HOME/Applications/mubone.app"; do
  [ -d "$candidate" ] && APP="$candidate" && break
done

if [ -z "$APP" ]; then
  echo "❌ mubone.app not found in /Applications or ~/Applications."
  echo "   Install it first, or use 'npm run stations' from the dev checkout."
  echo ""
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

NAMES=(a b c d e f g h i)
echo "Launching $COUNT station(s) from $APP"

for ((n = 0; n < COUNT; n++)); do
  name="${NAMES[n]}"
  port=$((7500 + n * 10))
  echo "  station $name  →  OSC udp $port"
  open -n -a "$APP" --args --instance="$name" --osc-port="$port" --station-count="$COUNT"
  sleep 1.5   # let Launch Services finish before spawning the next copy
done

echo ""
echo "✅ Done. Each window shows its station name in the title bar and top bar."
echo "   Connect one x-imu3 per window in the sensor modal."
sleep 2
