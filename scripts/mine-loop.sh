#!/usr/bin/env bash
# Deprecated wrapper — use mine_daemon.sh / mine_tick.sh
exec "$(cd "$(dirname "$0")" && pwd)/mine_daemon.sh" "$@"
