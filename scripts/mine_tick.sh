#!/usr/bin/env bash
# Lean one-shot: if a 10MM block is owed, mine it and push mint log to GitHub.
# Exit 0 always for cron/daemon (logs to stderr). Usage-cheap: no browser, no cards.
set -euo pipefail

PACKAGE_ID="${PACKAGE_ID:-0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98}"
REWARD_POOL_ID="${REWARD_POOL_ID:-0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619}"
HOLDER_REGISTRY_ID="${HOLDER_REGISTRY_ID:-0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9}"
FEE_POT_ID="${FEE_POT_ID:-0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213}"
CLOCK_ID="${CLOCK_ID:-0x6}"
GAS_BUDGET="${GAS_BUDGET:-10000000}"
BLOCK_SECS="${BLOCK_SECS:-600}"
REPO_DIR="${REPO_DIR:-/workspace/10MinMine-remote}"
OPS_ADDR="${OPS_ADDR:-0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a}"
SUBSIDY_10MM_PER_BLOCK="${SUBSIDY_10MM_PER_BLOCK:-50}"

log() { printf '[mine_tick %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# Require mainnet + ops wallet
env_name="$(sui client active-env 2>/dev/null || true)"
addr="$(sui client active-address 2>/dev/null || true)"
if [[ "$env_name" != *mainnet* ]]; then
  log "skip: active-env is '$env_name' (need mainnet)"
  exit 0
fi
if [[ "$addr" != "$OPS_ADDR" ]]; then
  log "warn: active address $addr (expected ops $OPS_ADDR) — continuing"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.mine"' EXIT
if ! sui client object "$REWARD_POOL_ID" --json >"$tmp" 2>/dev/null; then
  log "fail: could not read RewardPool"
  exit 0
fi

# Parse height + last_block_ts (seconds)
eval "$(python3 - "$tmp" <<'PY'
import json,sys,re,time
raw=open(sys.argv[1]).read()
# prefer structured fields; fall back to regex
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
# handle ms vs s
now=int(time.time())
if ts_i > 10**12: ts_i//=1000
elapsed=max(0, now-ts_i)
print(f"HEIGHT={height}")
print(f"LAST_TS={ts_i}")
print(f"ELAPSED={elapsed}")
PY
)"

log "height=$HEIGHT last_ts=$LAST_TS elapsed=${ELAPSED}s"
if [[ "${ELAPSED}" -lt "$BLOCK_SECS" ]]; then
  log "no block owed (<${BLOCK_SECS}s) — quiet exit"
  exit 0
fi

log "mining…"
if ! sui client call \
  --package "$PACKAGE_ID" \
  --module tenmm \
  --function mine \
  --args "$REWARD_POOL_ID" "$HOLDER_REGISTRY_ID" "$FEE_POT_ID" "$CLOCK_ID" \
  --gas-budget "$GAS_BUDGET" >"$tmp.mine" 2>&1; then
  log "mine failed:"; cat "$tmp.mine" >&2 || true
  exit 0
fi

DIGEST="$(rg -o 'Transaction Digest:[[:space:]]*[A-Za-z0-9]+' "$tmp.mine" | awk '{print $NF}' | head -1 || true)"
AMOUNT_RAW="$(rg -o 'TENMM[^[:digit:]]*Amount:[[:space:]]*[0-9]+' "$tmp.mine" | rg -o '[0-9]+$' | head -1 || true)"
if [[ -z "$DIGEST" ]]; then
  DIGEST="$(rg -o 'Digest:[[:space:]]*[A-Za-z0-9]+' "$tmp.mine" | awk '{print $NF}' | head -1 || true)"
fi

# Re-read height after mine
sui client object "$REWARD_POOL_ID" --json >"$tmp" 2>/dev/null || true
NEW_HEIGHT="$(rg -o '"block_height"[[:space:]]*:[[:space:]]*"?[0-9]+' "$tmp" | rg -o '[0-9]+$' | head -1 || echo "$HEIGHT")"
BLOCKS=$(( NEW_HEIGHT - HEIGHT ))
if [[ "$BLOCKS" -le 0 ]]; then BLOCKS=1; fi
if [[ -n "$AMOUNT_RAW" ]]; then
  AMOUNT_10MM="$(python3 -c "print(int('$AMOUNT_RAW')/10**8)")"
else
  AMOUNT_10MM="$(python3 -c "print($BLOCKS * $SUBSIDY_10MM_PER_BLOCK)")"
  AMOUNT_RAW="$(python3 -c "print(int($AMOUNT_10MM * 10**8))")"
fi

log "success height ${HEIGHT}->${NEW_HEIGHT} blocks=$BLOCKS amount=${AMOUNT_10MM} digest=$DIGEST"

# Append mint log locally every mine; GitHub push + X only every PUBLISH_EVERY blocks.
PUBLISH_EVERY="${PUBLISH_EVERY:-20}"

append_mint_log() {
  python3 - "$REPO_DIR" "$NEW_HEIGHT" "$BLOCKS" "$AMOUNT_RAW" "$AMOUNT_10MM" "$DIGEST" "$OPS_ADDR" <<'PY'
import json,sys,shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
repo, height, blocks, minted_raw, amount, digest, ops = sys.argv[1:8]
root = Path(repo)/"site"/"data"
pub = Path(repo)/"site"/"public"
root.mkdir(parents=True, exist_ok=True)
pub.mkdir(parents=True, exist_ok=True)
amt = str(amount).rstrip("0").rstrip(".") if "." in str(amount) else str(amount)
status = {
  "network": "mainnet",
  "packageId": "0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98",
  "rewardPoolId": "0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619",
  "height": int(height),
  "lastMineDigest": digest,
  "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "launchAt": "2026-09-06T16:44:56Z",
}
(root/"mine-status.json").write_text(json.dumps(status, indent=2)+"\n")
log_path = root/"mine-log.json"
log = json.loads(log_path.read_text()) if log_path.exists() else []
entry = {
  "ts": datetime.now(timezone(timedelta(hours=1))).isoformat(),
  "height": int(height),
  "blocks": int(blocks),
  "minted_raw": str(minted_raw),
  "amount_10mm": amt,
  "event": "mainnet_mine",
  "digest": digest,
  "rewarded": [{"address": ops, "amount_10mm": amt}],
  "note": "50 10MM per block",
}
if digest and not any(e.get("digest")==digest for e in log):
  log.append(entry)
elif not digest:
  log.append(entry)
log_path.write_text(json.dumps(log, indent=2)+"\n")
# Mirror to public/ (site dashboard reads public/)
shutil.copyfile(root/"mine-status.json", pub/"mine-status.json")
shutil.copyfile(log_path, pub/"mine-log.json")
# Also mirror scratch workspace copies when present
for extra in (Path("/workspace/10MinMine/site/data"), Path("/workspace/10MinMine/site/public")):
  if extra.parent.exists():
    extra.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root/"mine-status.json", extra/"mine-status.json")
    shutil.copyfile(log_path, extra/"mine-log.json")
print(f"wrote mint log entries={len(log)} height={height}", flush=True)
PY
}

if [[ -d "$REPO_DIR/.git" ]]; then
  append_mint_log || log "mint log append failed (non-fatal)"
  if (( NEW_HEIGHT % PUBLISH_EVERY == 0 )); then
    (
      cd "$REPO_DIR"
      git pull --ff-only origin main >/dev/null 2>&1 || true
      git add site/data/mine-status.json site/data/mine-log.json site/public/mine-status.json site/public/mine-log.json
      if git diff --cached --quiet; then
        log "github: nothing to commit at height ${NEW_HEIGHT}"
      else
        GIT_AUTHOR_NAME='10MinMine Ops' GIT_AUTHOR_EMAIL='ops@10minmine.local' \
        GIT_COMMITTER_NAME='10MinMine Ops' GIT_COMMITTER_EMAIL='ops@10minmine.local' \
          git commit -m "mint log: height ${NEW_HEIGHT} (every ${PUBLISH_EVERY}) ${DIGEST}" >/dev/null
        git push origin HEAD >/dev/null
        log "github: pushed full mint log at height ${NEW_HEIGHT}"
      fi
    ) || log "github: update failed (non-fatal)"
  else
    log "mint log local-only (next site/X publish at height $(( (NEW_HEIGHT / PUBLISH_EVERY + 1) * PUBLISH_EVERY )))"
  fi
else
  log "no REPO_DIR at $REPO_DIR — skip mint log"
fi

# Queue X only every PUBLISH_EVERY heights: image lists all blocks+rewards. Quiet otherwise.
if [[ -n "$DIGEST" ]] && (( NEW_HEIGHT % PUBLISH_EVERY == 0 )); then
  CARD="/workspace/10MinMine/site/public/x-mine-card-latest.png"
  WINDOW_START=$(( NEW_HEIGHT - PUBLISH_EVERY + 1 ))
  BATCH_BLOCKS="$PUBLISH_EVERY"
  BATCH_AMOUNT="$(python3 -c "print($PUBLISH_EVERY * $SUBSIDY_10MM_PER_BLOCK)")"
  LOG_JSON="${REPO_DIR}/site/data/mine-log.json"
  if [[ -f /workspace/10MinMine/scripts/make_mine_x_batch_card.py ]]; then
    python3 /workspace/10MinMine/scripts/make_mine_x_batch_card.py \
      --log "$LOG_JSON" --start "$WINDOW_START" --end "$NEW_HEIGHT" \
      --output "$CARD" "/workspace/10MinMine/site/public/x-mine-card-h${NEW_HEIGHT}.png" /workspace/uploads/x-mine-card-latest.png \
      >/dev/null 2>&1 || log "batch card failed (non-fatal)"
  fi
  CAPTION="$(cat <<MSG
⛏ 10MinMine · ${PUBLISH_EVERY} blocks
Heights ${WINDOW_START}–${NEW_HEIGHT} · +${BATCH_AMOUNT} 10MM (50/block)
Full list in image · mint log on site
https://2secsui.github.io/10MinMine/site/
Latest: https://suiscan.xyz/mainnet/tx/${DIGEST}
#Sui #SuiNetwork #10MM #10MinMine #DeFi
MSG
)"
  printf '%s\n' "$CAPTION" >&2
  QUEUE="${QUEUE:-/workspace/10MinMine/scripts/pending_x_posts.jsonl}"
  python3 - "$QUEUE" "$DIGEST" "$NEW_HEIGHT" "$BATCH_BLOCKS" "$BATCH_AMOUNT" "$CAPTION" "$CARD" <<'PY2'
import json,sys,time
from pathlib import Path
queue, digest, height, blocks, amount, caption, image = sys.argv[1:8]
Path(queue).parent.mkdir(parents=True, exist_ok=True)
lines=[]
if Path(queue).exists():
  for line in Path(queue).read_text().splitlines():
    if not line.strip(): continue
    try:
      o=json.loads(line)
    except Exception:
      continue
    if o.get('digest')!=digest:
      lines.append(line)
row=json.dumps({"ts":int(time.time()),"digest":digest,"height":int(height),"blocks":int(blocks),"amount_10mm":str(amount),"caption":caption,"image":image,"posted":False,"every":20,"kind":"batch20"}, ensure_ascii=False)
lines.append(row)
Path(queue).write_text("\n".join(lines)+"\n")
print(f"queued batch X digest={digest} height={height}", flush=True)
PY2
  if [[ -x /workspace/10MinMine/scripts/post_pending_x.sh ]]; then
    /bin/bash /workspace/10MinMine/scripts/post_pending_x.sh || true
  fi
elif [[ -n "$DIGEST" ]]; then
  log "quiet until height $(( (NEW_HEIGHT / PUBLISH_EVERY + 1) * PUBLISH_EVERY )) (site+X)"
fi
exit 0
