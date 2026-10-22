#!/usr/bin/env python3
"""PreToolUse hook: validate marketplace.json versions match plugin.json.

On git push, verify that each version field in .claude-plugin/marketplace.json
matches the corresponding plugins/<name>/.claude-plugin/plugin.json version.

Exit codes:
  0 = pass (fail-open included)
  Block decision returned via JSON stdout
"""

import json
import os
import re
import subprocess
import sys


def is_git_push_command(command: str) -> bool:
    return bool(re.search(r"\bgit\s+push\b", command, re.IGNORECASE))


def get_git_root() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def check_version_consistency(git_root: str) -> list[str]:
    """Compare marketplace.json versions with plugin.json versions."""
    errors = []

    marketplace_path = os.path.join(git_root, ".claude-plugin", "marketplace.json")
    if not os.path.exists(marketplace_path):
        return []

    try:
        with open(marketplace_path) as f:
            marketplace_data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []

    for entry in marketplace_data.get("plugins", []):
        name = entry.get("name", "")
        marketplace_version = entry.get("version", "")

        if not name or not marketplace_version:
            continue

        plugin_json_path = os.path.join(
            git_root, "plugins", name, ".claude-plugin", "plugin.json"
        )
        if not os.path.exists(plugin_json_path):
            continue

        try:
            with open(plugin_json_path) as f:
                plugin_data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        actual_version = plugin_data.get("version", "")
        if actual_version and marketplace_version != actual_version:
            errors.append(
                f"{name}: marketplace.json={marketplace_version} vs plugin.json={actual_version}"
            )

    return errors


def main():
    try:
        input_data = json.load(sys.stdin)

        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input", {})
        command = tool_input.get("command", "")

        if tool_name != "Bash":
            print(json.dumps({}))
            sys.exit(0)

        if not is_git_push_command(command):
            print(json.dumps({}))
            sys.exit(0)

        git_root = get_git_root()
        if not git_root:
            print(json.dumps({}))
            sys.exit(0)

        errors = check_version_consistency(git_root)

        if errors:
            lines = "\n".join(f"  - {e}" for e in errors)
            reason = (
                "[BLOCK] marketplace.json version mismatch\n\n"
                "Align .claude-plugin/marketplace.json versions before pushing:\n"
                f"{lines}\n\n"
                "Fix: update each marketplace.json plugin version to match plugin.json"
            )
            print(json.dumps({"decision": "block", "reason": reason}))
        else:
            print(json.dumps({}))

    except Exception:
        print(json.dumps({}))

    sys.exit(0)


if __name__ == "__main__":
    main()
