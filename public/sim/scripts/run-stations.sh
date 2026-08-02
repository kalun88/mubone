#!/usr/bin/env bash
# ============================================================================
# run-stations.sh — launch N station instances (default 3).
#
#   npm run stations            → 3 stations (a, b, c)
#   npm run stations -- 2       → 2 stations (a, b)
#   sh scripts/run-stations.sh 4
#
# Station i gets instance name a/b/c/… and OSC port 7500 + (i-1)*10:
#   a=7500  b=7510  c=7520  d=7530 …
#
# Each instance has an isolated userData profile (own presets, calibration,
# audio defaults). The port is the instance address — OSC address strings are
# identical across stations. Solo use is unchanged: `npm run electron`.
# Remember: each x-imu3 needs a DISTINCT send port (8000/8001/8002…) — see
# docs/MULTI-INSTANCE-PLAN.md §1.2.
# ============================================================================
set -e
cd "$(dirname "$0")/.."

COUNT="${1:-3}"
case "$COUNT" in
  [1-9]) ;;
  *) echo "usage: run-stations.sh [count 1-9]" >&2; exit 1 ;;
esac

NAMES=(a b c d e f g h i)
for ((n = 0; n < COUNT; n++)); do
  # --station-count tiles the windows: each takes 1/COUNT of the screen and
  # parks in its own column (a leftmost), already in narrow layout at 3-across.
  npx electron . --instance="${NAMES[n]}" --osc-port=$((7500 + n * 10)) \
    --station-count="$COUNT" &
done

wait
