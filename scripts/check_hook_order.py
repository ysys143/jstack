#!/usr/bin/env python3
"""Validate hook event order and the documented chain against current sources."""

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXPECTED_ORDER = {
    "hooks/hooks.json": {
        "PreToolUse": [
            "block_emoji.py",
            "hwpx_guard.py",
            "check_model_versions.py",
            "validate_uv_usage.py",
            "check_readme_version.py",
            "check_marketplace_versions.py",
            "ruff_check_before_commit.py",
            "validate_before_publish.sh",
            "validate_pr_label.py",
        ],
        "PostToolUse": ["ruff_check_after_edit.py"],
        "Stop": ["commit-session.sh"],
        "SessionStart": ["load-recent-changes.sh", "ensure-statusline.mjs"],
    }
}


def check_hook_order() -> list[str]:
    problems: list[str] = []
    for relative, expected in EXPECTED_ORDER.items():
        path = hook_path(relative)
        if not path.is_file():
            problems.append(f"훅 선언이 없다: {relative}")
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        events = document.get("hooks", {})
        undeclared = sorted(set(events) - set(expected))
        if undeclared:
            problems.append(
                f"{relative}: 선언에 없는 이벤트 {undeclared} — EXPECTED_ORDER 에 이벤트별 순서를 적어라"
            )
        for event, want in expected.items():
            seen: list[str] = []
            for entry in events.get(event, []):
                for hook in entry.get("hooks", []):
                    name = hook.get("command", "").split("/")[-1].strip("\"'")
                    if name:
                        seen.append(name)
            ordered = seen
            if ordered != want:
                problems.append(
                    f"{relative} {event}: 발화 순서가 선언과 다르다\n      선언 {want}\n      실물 {ordered}"
                )
    return problems


def check_contract_table() -> list[str]:
    problems: list[str] = []
    for relative in EXPECTED_ORDER:
        contract = hook_path(relative).parent / "CONTRACT.md"
        if not contract.is_file():
            problems.append(f"CONTRACT.md 가 없다: {contract.relative_to(REPO)}")
            continue
        text = contract.read_text(encoding="utf-8")
        rows = re.findall(
            "(?m)^\\|\\s*(\\d+)\\s*\\|\\s*`([^`]+)`\\s*\\|\\s*`([^`]+)`\\s*\\|", text
        )
        if not rows:
            problems.append(
                f"{contract.relative_to(REPO)}: 「체인 순서」 표를 못 읽었다 — 형식이 바뀌었나"
            )
            continue
        doc_order = [
            Path(name).name for _, name, _ in sorted(rows, key=lambda r: int(r[0]))
        ]
        want = EXPECTED_ORDER[relative].get("PreToolUse", [])
        if doc_order != want:
            problems.append(
                f"{contract.relative_to(REPO)}: 표의 순서가 실물과 다르다 — 표 {doc_order} / 실물 {want}"
            )
        document = json.loads(hook_path(relative).read_text(encoding="utf-8"))
        actual = {}
        for entry in document.get("hooks", {}).get("PreToolUse", []):
            for hook in entry.get("hooks", []):
                actual.setdefault(
                    Path(hook.get("command", "")).name.strip("\"'"),
                    entry.get("matcher", ""),
                )
        for _, name, matcher in rows:
            got = actual.get(Path(name).name)
            if got is None:
                problems.append(
                    f"{contract.relative_to(REPO)}: 표에 있는 `{name}` 이 hooks.json 에 없다"
                )
            elif matcher.replace("\\|", "|") != got:
                problems.append(
                    f"{contract.relative_to(REPO)}: `{name}` matcher 가 다르다 — 표 `{matcher}` / 실물 `{got}`"
                )
    return problems


def hook_path(relative):
    base = REPO / "hosts/claude" if (REPO / "hosts/claude").is_dir() else REPO
    return base / relative


if __name__ == "__main__":
    problems = check_hook_order() + check_contract_table()
    for problem in problems:
        print("[FAIL]", problem)
    print(f"Hook chain problems: {len(problems)}")
    raise SystemExit(bool(problems))
