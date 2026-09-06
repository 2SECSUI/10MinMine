#!/usr/bin/env bash
# Runs mine_tick.sh every INTERVAL seconds (default 600). Low Grok usage: no agent wake.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
INTERVAL="${INTERVAL:-600}"
LOG="${LOG:-/workspace/10MinMine/scripts/mine_daemon.log}"
echo "[mine_daemon $(date -u +%Y-%m-%dT%H:%M:%SZ)] start interval=${INTERVAL}s" | tee -a "$LOG"
while true; do
  /bin/bash "$DIR/mine_tick.sh" >>"$LOG" 2>&1 || true
  sleep "$INTERVAL"
done
