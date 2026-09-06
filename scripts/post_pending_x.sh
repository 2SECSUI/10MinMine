#!/usr/bin/env bash
# Placeholder: X has no CLI API key on this box.
# Grok routine drains pending_x_posts.jsonl via browser (@TenMinMine) with caption+image.
# Exit 1 when unposted rows exist so callers know work remains.
set -euo pipefail
QUEUE="${QUEUE:-/workspace/10MinMine/scripts/pending_x_posts.jsonl}"
[[ -f "$QUEUE" ]] || exit 0
python3 - "$QUEUE" <<'PY'
import json,sys
from pathlib import Path
q=Path(sys.argv[1])
pending=0
for line in q.read_text().splitlines():
  if not line.strip(): continue
  try: o=json.loads(line)
  except Exception: continue
  if not o.get('posted'):
    pending+=1
    img=o.get('image') or ''
    print(f"pending height={o.get('height')} digest={o.get('digest')} image={img}", flush=True)
sys.exit(1 if pending else 0)
PY
