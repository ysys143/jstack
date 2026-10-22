#!/usr/bin/env python3
"Check line-number citations that resolve to local skill sources."

import os
import re
import sys

sys.dont_write_bytecode = True
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TREES = (".",)
CITE = re.compile(
    "(?P<path>[A-Za-z0-9_./-]+\\.(?:md|py|js|sh|yaml|toml|xml|json)):(?P<a>\\d+)(?:-(?P<b>\\d+))?\\b"
)


def docs():
    for tree in TREES:
        root = os.path.join(REPO, tree, "skills")
        if not os.path.isdir(root):
            continue
        for sk in sorted(os.listdir(root)):
            sd = os.path.join(root, sk)
            if not os.path.isdir(sd) or sk == "__pycache__":
                continue
            for sub in ("", "references"):
                d = os.path.join(sd, sub) if sub else sd
                if not os.path.isdir(d):
                    continue
                for fn in sorted(os.listdir(d)):
                    if fn.endswith(".md"):
                        yield (sk, sd, os.path.join(d, fn))


def resolve(skill_dir, path):
    if "/" not in path:
        return None
    for base in (skill_dir, os.path.dirname(skill_dir), REPO):
        p = os.path.normpath(os.path.join(base, path))
        if os.path.isfile(p):
            return p
    return None


def main():
    bad, outside, total = ([], [], 0)
    for sk, sd, doc in docs():
        with open(doc, encoding="utf-8") as f:
            text = f.read()
        rel_doc = os.path.relpath(doc, REPO)
        for m in CITE.finditer(text):
            total += 1
            path, a = (m.group("path"), int(m.group("a")))
            b = int(m.group("b") or a)
            fp = resolve(sd, path)
            if fp is None:
                outside.append(f"{rel_doc} -> {path}:{a}")
                continue
            with open(fp, encoding="utf-8", errors="replace") as f:
                n = sum((1 for _ in f))
            if b > n:
                bad.append(
                    f"{rel_doc} -> {path}:{m.group('a')}"
                    + (f"-{m.group('b')}" if m.group("b") else "")
                    + f" (그 파일은 {n}줄)"
                )
    print(
        f"행 번호 인용 {total}건 — 트리 안 {total - len(outside)} · 모호·트리 밖 {len(outside)} · 죽은 인용 {len(bad)}"
    )
    for x in outside:
        print(f"  [모호·외부] {x} — 여기서는 못 잰다")
    for x in bad:
        print(f"  [FAIL] {x}")
    inside = total - len(outside)
    if total == 0:
        print("  [FAIL] 인용이 한 건도 없다 — 이 검사기가 아무것도 재지 않는다")
        return 1
    if inside == 0:
        print("  [FAIL] 잴 수 있는 인용이 한 건도 없다 — 전건이 모호하거나 트리 밖이다")
        return 1
    if inside * 4 < total:
        print(
            f"  [알림] 잴 수 있는 인용이 {inside}/{total} 뿐이다 — 인용에 디렉터리 접두가 없다"
        )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
