#!/usr/bin/env python3
"""Check OAuth token expiry for each gws account **before writing**.

## Why check in advance

Expiry can surface mid-run, after partial records already exist: two of five Daily Scrum
cells written or half of a weekly report uploaded. Reads can be retried, but writes are
not reversible, so **checking once before starting** is always cheaper than failing midway.

`ensure_gws.sh` answers “are the tool and account settings present?” This script answers
the next question — **“can this account write now?”**

## Exit codes (fail-closed)

  0 = every account found is valid and has more than the safety margin remaining
  1 = an account is expired, near expiry, or unauthenticated -> re-authenticate and retry
  2 = **indeterminate** -> no accounts exist or expiry cannot be read from encrypted tokens;
      do not answer unknown as 0

Priority 1 precedes 2. A confirmed expiry has a defined action and is reported first;
only when none exists does the result become “indeterminate.”

## What is read

Look for token files in each account config directory (`~/.config/gws-*`).

  - `token.json` · `credentials.json` — plain JSON; read the expiry field directly
  - `credentials.enc` — encrypted storage; **expiry cannot be read** (indeterminate)
  - no file — unauthenticated

Three expiry spellings are accepted because tools and versions differ.

  - `expiry`      — RFC3339 string (`2026-09-01T12:00:00Z`)
  - `expires_at`  — epoch seconds
  - `expiry_date` — epoch milliseconds

**Never print token values.** Print only paths and expiry times; this output can remain in
logs and may be sent by mail.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import sys

TOKEN_FILES = ("token.json", "credentials.json", "oauth_token.json")
ENCRYPTED_FILES = ("credentials.enc",)
# A run can take several minutes; a token with three minutes left can expire mid-run.
DEFAULT_MARGIN_MIN = 10

OK, EXPIRED, SOON, NONE, UNKNOWN = "ok", "expired", "soon", "none", "unknown"
# A status with a defined action; any such account returns exit 1.
ACTIONABLE = (EXPIRED, SOON, NONE)


def parse_expiry(raw):
    """Extract an expiry time as an aware datetime from token JSON, or None if unreadable."""
    if not isinstance(raw, dict):
        return None
    v = raw.get("expiry")
    if isinstance(v, str) and v:
        s = v.strip().replace("Z", "+00:00")
        try:
            d = dt.datetime.fromisoformat(s)
        except ValueError:
            return None
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    v = raw.get("expires_at")
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(float(v), dt.timezone.utc)
    v = raw.get("expiry_date")
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(float(v) / 1000.0, dt.timezone.utc)
    return None


def inspect(config_dir, now, margin_min):
    """Evaluate one account and return (status, expiry time or reason)."""
    for name in TOKEN_FILES:
        p = os.path.join(config_dir, name)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError):
            return UNKNOWN, f"cannot read {name}"
        exp = parse_expiry(raw)
        if exp is None:
            return UNKNOWN, f"{name} has no expiry field"
        if exp <= now:
            return EXPIRED, exp
        if exp - now < dt.timedelta(minutes=margin_min):
            return SOON, exp
        return OK, exp
    for name in ENCRYPTED_FILES:
        if os.path.isfile(os.path.join(config_dir, name)):
            return UNKNOWN, f"{name} is encrypted; expiry cannot be read"
    return NONE, "no token file — not authenticated yet"


def fmt(v, now):
    if isinstance(v, dt.datetime):
        left = v - now
        mins = int(left.total_seconds() // 60)
        return f"{v.astimezone().strftime('%Y-%m-%d %H:%M')} ({mins:+d} min)"
    return str(v)


def main(argv=None):
    ap = argparse.ArgumentParser(description="check gws account OAuth token expiry in advance")
    ap.add_argument("--config-dir", help="one selected account config directory; do not inspect others")
    ap.add_argument("--config-base", default=os.path.join(os.path.expanduser("~"), ".config"),
                    help="parent directory for account configs (default ~/.config)")
    ap.add_argument("--pattern", default="gws-*", help="account directory glob (default gws-*)")
    ap.add_argument("--margin", type=int, default=DEFAULT_MARGIN_MIN,
                    help=f"treat expiry within this many minutes as near (default {DEFAULT_MARGIN_MIN})")
    ap.add_argument("--json", action="store_true", help="output the decision as JSON")
    a = ap.parse_args(argv)

    now = dt.datetime.now(dt.timezone.utc)
    dirs = ([os.path.abspath(os.path.expanduser(a.config_dir))] if a.config_dir else
            sorted(d for d in glob.glob(os.path.join(a.config_base, a.pattern)) if os.path.isdir(d)))

    rows = []
    for d in dirs:
        verdict, info = inspect(d, now, a.margin)
        rows.append({"account": os.path.basename(d), "dir": d, "verdict": verdict,
                     "detail": fmt(info, now)})

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    else:
        for r in rows:
            print(f"{r['account']}: {r['verdict']} — {r['detail']}")

    if not rows:
        # **Zero accounts is not a pass.** There is nothing measured when there is no target.
        print(f"No account directory found ({a.config_base}/{a.pattern})")
        print("  Check installation and settings with bash scripts/ensure_gws.sh first")
        print("[2] indeterminate")
        return 2

    bad = [r for r in rows if r["verdict"] in ACTIONABLE]
    if bad:
        print(f"Accounts requiring re-authentication ({len(bad)}): "
              + ", ".join(r["account"] for r in bad))
        print("  GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<directory> gws auth login")
        print("  **Start writes only after re-authentication** — mid-run expiry leaves partial records")
        print("[1] re-authentication required")
        return 1

    unknown = [r for r in rows if r["verdict"] == UNKNOWN]
    if unknown:
        print(f"Accounts whose expiry could not be read ({len(unknown)}): "
              + ", ".join(r["account"] for r in unknown))
        print("  Inspect directly with GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<directory> gws auth status")
        print("[2] indeterminate")
        return 2

    print(f"All {len(rows)} accounts are valid (margin: {a.margin} min)")
    print("[0] available")
    return 0


if __name__ == "__main__":
    sys.exit(main())
