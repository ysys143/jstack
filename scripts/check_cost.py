#!/usr/bin/env python3
"Check shipped package size and estimated resident-description tokens."

import argparse
import glob
import io
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUDGET = {
    "jstack": {
        "always_on_tokens": 7566,
        "dist_bytes": 83886080,
        "why": "2026-09-10: user-approved size increase for the Node runtime and offline native assets. Fixed 80 MiB ceiling; resident-description token ceiling unchanged.",
    }
}
NOT_SHIPPED = ("__pycache__", ".pytest_cache", "node_modules")


def toks(s: str) -> int:
    ko = sum((1 for c in s if "가" <= c <= "힣"))
    return ko + (len(s) - ko + 3) // 4


def descriptions(tree_root: str):
    parts = []
    pats = (
        ("skill", os.path.join(tree_root, "skills", "*", "SKILL.md")),
        ("command", os.path.join(tree_root, "commands", "*.md")),
        ("agent", os.path.join(tree_root, "agents", "*.md")),
    )
    for kind, pat in pats:
        for p in sorted(glob.glob(pat)):
            try:
                t = io.open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            m = re.match("^---\\n(.*?)\\n---", t, re.S)
            if not m:
                continue
            d = re.search(
                "(?m)^description:\\s*(.*?)(?=\\n[a-z][a-z-]*:|\\Z)", m.group(1), re.S
            )
            if not d:
                continue
            name = (
                os.path.basename(os.path.dirname(p))
                if kind == "skill"
                else os.path.basename(p)[:-3]
            )
            parts.append((kind, name, toks(d.group(1).strip())))
    mp = os.path.join(tree_root, ".claude-plugin", "plugin.json")
    if os.path.isfile(mp):
        try:
            j = json.load(io.open(mp, encoding="utf-8"))
            if j.get("description"):
                parts.append(("manifest", j.get("name", "?"), toks(j["description"])))
        except (OSError, ValueError):
            pass
    return parts


def dist_bytes(tree_root: str) -> int:
    total = 0
    for dp, dn, fn in os.walk(tree_root):
        dn[:] = [d for d in dn if d not in NOT_SHIPPED]
        for n in fn:
            try:
                total += os.path.getsize(os.path.join(dp, n))
            except OSError:
                pass
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--package",
        default=os.environ.get("JSTACK_PACKAGE_ROOT"),
        help="Built outer package; all shipped bytes are counted",
    )
    a = ap.parse_args()
    out, bad = ({}, 0)
    for tree, budget in BUDGET.items():
        if not a.package:
            print("[2] --package 또는 JSTACK_PACKAGE_ROOT로 실제 배포본을 지정해야 한다")
            return 2
        root = os.path.realpath(a.package)
        if not os.path.isdir(root):
            print(f"[2] 트리가 없다: {root}")
            return 2
        parts = descriptions(os.path.join(root, "payload"))
        codex_parts = descriptions(os.path.join(root, "payload"))
        for host in ("claude", "codex"):
            host_parts = []
            for path in sorted(
                glob.glob(os.path.join(root, "entries", host, "*", "SKILL.md"))
            ):
                text = io.open(path, encoding="utf-8").read()
                match = re.search("(?m)^description:\\s*(.*)$", text)
                if match:
                    host_parts.append(
                        (
                            "skill",
                            os.path.basename(os.path.dirname(path)),
                            toks(match.group(1)),
                        )
                    )
            host_parts += [
                p
                for p in parts
                if p[0] == "manifest"
                or (host == "claude" and p[0] in {"command", "agent"})
            ]
            if host == "claude":
                claude_parts = host_parts
            else:
                codex_parts = host_parts
        parts = max(
            (claude_parts, codex_parts), key=lambda rows: sum((row[2] for row in rows))
        )
        tok = sum((p[2] for p in parts))
        by = dist_bytes(root)
        out[tree] = {
            "always_on_tokens": tok,
            "dist_bytes": by,
            "budget": budget,
            "top": sorted(parts, key=lambda x: -x[2])[:5],
        }
        bad += sum(
            (out[tree][key] > budget[key] for key in ("always_on_tokens", "dist_bytes"))
        )
        if not a.json:
            print(f"## {tree}")
            for key, unit in (("always_on_tokens", "토큰"), ("dist_bytes", "B")):
                got, cap = (out[tree][key], budget[key])
                ok = got <= cap
                _slack = cap - got
                print(
                    f"  [{('OK' if ok else 'FAIL')}] {key} — {got:,}{unit} / 상한 {cap:,}{unit}"
                    + ("" if ok else f"  초과 {got - cap:,}")
                    + (
                        f"  여유 {_slack:,} — 천장을 실측치로 내려라"
                        if ok and _slack
                        else ""
                    )
                )
            print(f"  선언 {len(parts)}건 · 상위:")
            for kind, name, v in out[tree]["top"]:
                print(f"      {v:>5} 토큰  {kind}/{name}")
            print(f"  ({budget['why']})")
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return 1 if bad else 0
    print()
    total_tok = sum((v["always_on_tokens"] for v in out.values()))
    print(f"단일 플러그인 선언 토큰 추정 {total_tok:,} — 호스트 관측값 아님")
    print(f"초과 {bad}건")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
