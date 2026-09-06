#!/usr/bin/env bash
# Runs mine_tick.sh every INTERVAL seconds (default 720 = 12m). Low Grok usage.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
INTERVAL="${INTERVAL:-720}"
LOG="${LOG:-/workspace/10MinMine/scripts/mine_daemon.log}"
PIDFILE="${PIDFILE:-/workspace/10MinMine/scripts/mine_daemon.pid}"
echo $$ > "$PIDFILE"
echo "[mine_daemon $(date -u +%Y-%m-%dT%H:%M:%SZ)] start interval=${INTERVAL}s pid=$$" | tee -a "$LOG"
while true; do
  /bin/bash "$DIR/mine_tick.sh" >>"$LOG" 2>&1 || true
  sleep "$INTERVAL"
done
