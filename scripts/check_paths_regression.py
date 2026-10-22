#!/usr/bin/env python3
"Reject newly unresolved references and missing or crashed checkers."

import os
import re
import subprocess
import sys
from pathlib import Path


def runtime_root():
    root = Path(
        os.environ.get("JSTACK_RUNTIME_ROOT", Path(__file__).resolve().parent.parent)
    )
    if not root.is_dir():
        raise RuntimeError(f"runtime root is missing: {root}")
    return root


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(REPO, "tests", "fixtures", "path-reference-baseline.txt")
CHECKER = os.path.join(REPO, "scripts", "check_plugin_paths.py")
TREES = ("jstack",)
CEILING = 0


def parse_miss(text):
    out, ref = (set(), None)
    for line in text.splitlines():
        m = re.match("^  (?!  )(\\S.*)$", line)
        if m and (not line.startswith("    ")):
            ref = m.group(1).strip()
            continue
        m2 = re.match("^    <- (.+)$", line)
        if m2 and ref:
            out.add((ref, m2.group(1).strip()))
            ref = None
    return out


def baseline_by_tree():
    if not os.path.isfile(BASELINE):
        return None
    txt = Path(BASELINE).read_text(encoding="utf-8")
    out, cur, buf = ({}, None, [])
    for line in txt.splitlines():
        m = re.match("^## (\\S+)", line)
        if m:
            if cur:
                out[cur] = parse_miss("\n".join(buf))
            cur, buf = (m.group(1), [])
            continue
        buf.append(line)
    if cur:
        out[cur] = parse_miss("\n".join(buf))
    return out


def main():
    base = baseline_by_tree()
    if base is None:
        print(f"[2] 기준선이 없다: {BASELINE}")
        return 2
    if not os.path.isfile(CHECKER):
        print(f"[2] 검사기가 없다: {CHECKER}")
        return 2
    new_total = 0
    for tree in TREES:
        try:
            actual_root = runtime_root()
        except RuntimeError as exc:
            print(f"[2] {exc}")
            return 2
        r = subprocess.run(
            [sys.executable, CHECKER, str(actual_root)],
            capture_output=True,
            text=True,
            cwd=REPO,
        )
        if (
            r.returncode not in (0, 1)
            or "Traceback (most recent call last)" in r.stderr
        ):
            print(f"[2] {tree}: 검사기가 죽었다 (rc={r.returncode})")
            for ln in r.stderr.strip().splitlines()[-3:]:
                print(f"    {ln}")
            return 2
        if not r.stdout.strip():
            print(f"[2] {tree}: 검사기가 아무것도 안 냈다 — 0 을 통과로 읽지 않는다")
            return 2
        summary = re.search(r"^참조 (\d+)건 / 실재 \d+건 / MISS \d+건", r.stdout, re.M)
        if not summary or int(summary.group(1)) == 0 or "위생 위반 " in r.stdout:
            print(f"[2] {tree}: missing measurement or repository hygiene failure")
            return 2
        cur = parse_miss(r.stdout)
        if r.returncode == 1 and not cur:
            print(f"[2] {tree}: checker failed without parsed reference diagnostics")
            return 2
        old = base.get(tree, set())
        new = sorted(cur - old)
        gone = sorted(old - cur)
        new_total += len(new)
        print(
            f"{tree}: MISS {len(cur)}건 (기준선 {len(old)}) — 신규 {len(new)} · 해소 {len(gone)}"
        )
        for ref, src in new:
            print(f"  [신규] {ref}\n           <- {src}")
        if gone:
            print(f"  해소 {len(gone)}건 — 기준선을 조일 때가 됐다는 신호다")
    print()
    print(f"신규 MISS {new_total}건 / 천장 {CEILING}")
    if new_total > CEILING:
        print(f"  [FAIL] 천장 초과 {new_total - CEILING}건 — 참조가 새로 죽었다")
        return 1
    if new_total < CEILING:
        print(f"  줄었다 {CEILING} -> {new_total} — 천장을 조여라")
    return 0


if __name__ == "__main__":
    sys.exit(main())
