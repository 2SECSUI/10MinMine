#!/usr/bin/env python3
"""Post a tweet to X/Twitter with OAuth 1.0a (stdlib only).

Env (or --env-file):
  X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def pct(s: str) -> str:
    return urllib.parse.quote(str(s), safe="-_.~")


def oauth_header(method: str, url: str, params: dict, keys: dict) -> str:
    oauth = {
        "oauth_consumer_key": keys["api_key"],
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": keys["access_token"],
        "oauth_version": "1.0",
    }
    all_params = {**params, **oauth}
    base = "&".join(f"{pct(k)}={pct(all_params[k])}" for k in sorted(all_params))
    sig_base = "&".join([method.upper(), pct(url), pct(base)])
    signing_key = f"{pct(keys['api_secret'])}&{pct(keys['access_secret'])}"
    digest = hmac.new(signing_key.encode(), sig_base.encode(), hashlib.sha1).digest()
    oauth["oauth_signature"] = base64.b64encode(digest).decode()
    return "OAuth " + ", ".join(f'{pct(k)}="{pct(oauth[k])}"' for k in sorted(oauth))


def post_tweet(text: str, keys: dict) -> dict:
    url = "https://api.twitter.com/2/tweets"
    body = json.dumps({"text": text}).encode("utf-8")
    headers = {
        "Authorization": oauth_header("POST", url, {}, keys),
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        raise SystemExit(f"X API HTTP {e.code}: {err}") from e


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--env-file", default="")
    args = ap.parse_args()
    here = Path(__file__).resolve().parent
    for candidate in (
        Path(args.env_file) if args.env_file else None,
        here / "secrets" / "x-api.env",
        here / "x-api.env",
    ):
        if candidate:
            load_env_file(candidate)

    keys = {
        "api_key": os.environ.get("X_API_KEY", "").strip(),
        "api_secret": os.environ.get("X_API_SECRET", "").strip(),
        "access_token": os.environ.get("X_ACCESS_TOKEN", "").strip(),
        "access_secret": os.environ.get("X_ACCESS_TOKEN_SECRET", "").strip(),
    }
    if not all(keys.values()):
        raise SystemExit(
            "Missing X API keys. Copy secrets/x-api.env.example to secrets/x-api.env and fill in values."
        )

    text = args.text.strip()
    if len(text) > 280:
        text = text[:277] + "..."
    result = post_tweet(text, keys)
    tid = (result.get("data") or {}).get("id")
    url = f"https://x.com/i/web/status/{tid}" if tid else ""
    print(json.dumps({"ok": True, "id": tid, "url": url, "raw": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
