#!/usr/bin/env bash
# Mine only if at least one 10-minute block is owed on-chain (RewardPool clock).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_ID="${PACKAGE_ID:-0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98}"
REWARD_POOL_ID="${REWARD_POOL_ID:-0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619}"
BLOCK_SECS="${BLOCK_SECS:-600}"

if ! command -v sui >/dev/null 2>&1; then
  echo "error: sui CLI not found in PATH" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sui client object "$REWARD_POOL_ID" --json >"$tmp"

eval "$(python3 - "$tmp" <<'PY'
import json,sys,re,time
raw=open(sys.argv[1]).read()
height=None; ts=None
try:
  d=json.loads(raw)
  def walk(o):
    global height, ts
    if isinstance(o, dict):
      if "block_height" in o: height=str(o["block_height"])
      if "last_block_ts" in o: ts=str(o["last_block_ts"])
      for v in o.values(): walk(v)
    elif isinstance(o, list):
      for v in o: walk(v)
  walk(d)
except Exception:
  pass
if height is None:
  m=re.search(r'"block_height"\s*:\s*"?(\d+)"?', raw); height=m.group(1) if m else "0"
if ts is None:
  m=re.search(r'"last_block_ts"\s*:\s*"?(\d+)"?', raw); ts=m.group(1) if m else "0"
ts_i=int(ts)
now=int(time.time())
if ts_i > 10**12: ts_i//=1000
elapsed=max(0, now-ts_i)
print(f"HEIGHT={height}")
print(f"LAST_TS={ts_i}")
print(f"ELAPSED={elapsed}")
PY
)"

echo "height=$HEIGHT last_ts=$LAST_TS elapsed=${ELAPSED}s (need >= ${BLOCK_SECS}s)"
if [[ "${ELAPSED}" -lt "$BLOCK_SECS" ]]; then
  remain=$(( BLOCK_SECS - ELAPSED ))
  echo "no block owed — wait ~${remain}s"
  exit 0
fi

exec "$DIR/mine_once.sh"
