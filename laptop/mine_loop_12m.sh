#!/usr/bin/env bash
# Call mine every 12 minutes when a block is owed. Ctrl-C to stop.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
INTERVAL="${INTERVAL:-720}"
echo "10MM mine loop every ${INTERVAL}s — Ctrl-C to stop"
while true; do
  echo "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) ----"
  /bin/bash "$DIR/mine_if_owed.sh" || true
  sleep "$INTERVAL"
done
