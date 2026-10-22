#!/usr/bin/env python3
"""Require one canonical library, runner, and emoji hook in source and payload."""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CANONICAL = {
    "skills/_suite_lib.py": "skills/_suite_lib.py",
    "scripts/run_suites.sh": "scripts/run_suites.sh",
    "hosts/claude/" + "hooks/block_emoji.py": "hooks/block_emoji.py",
}


def check(root):
    problems = []
    source_layout = (root / "hosts/claude").is_dir()
    try:
        rows = json.loads((root / "packaging/package-files.json").read_text())["files"]
    except (OSError, ValueError, KeyError) as exc:
        return [f"package membership unreadable: {exc}"]
    for source, target in CANONICAL.items():
        path = root / (source if source_layout else target)
        if not path.is_file() or not path.stat().st_size:
            problems.append(
                f"canonical file missing or empty: {path.relative_to(root)}"
            )
        bindings = [
            r for r in rows if r.get("source") == source or r.get("target") == target
        ]
        if bindings != [{"source": source, "target": target}]:
            problems.append(f"canonical membership is not unique: {source}")
    for path in (root / "skills").rglob("_suite_lib.py"):
        if path != root / "skills/_suite_lib.py":
            problems.append(f"duplicate suite library: {path.relative_to(root)}")
    for name in ("staging", "refactor", "plugins"):
        if (root / name).exists():
            problems.append(f"retired source tree remains: {name}")
    return problems


def main():
    problems = check(REPO)
    for problem in problems:
        print("[FAIL]", problem)
    print(f"Canonical files: {len(CANONICAL)}; problems: {len(problems)}")
    return int(bool(problems))


if __name__ == "__main__":
    raise SystemExit(main())
