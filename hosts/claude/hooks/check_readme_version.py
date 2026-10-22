#!/usr/bin/env python3
"""PreToolUse hook: plugin.json version vs README.md consistency check.

When a git commit stages files under a plugin directory:
1. Verify that the plugin.json version appears in the plugin README.md changelog.
2. Verify that the root README.md version table contains the correct version.
3. Verify that the plugin is registered in the .claude-plugin/marketplace.json plugins array.

Exit codes:
  0 = pass (fail-open included)
  No abnormal termination -- block/allow controlled via JSON stdout
"""

import json
import os
import re
import subprocess
import sys


def is_git_commit_command(command: str) -> bool:
    return bool(re.search(r"\bgit\s+commit\b", command, re.IGNORECASE))


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


def get_staged_files(git_root: str) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=git_root,
        )
        if result.returncode == 0:
            return [f for f in result.stdout.strip().split("\n") if f]
    except Exception:
        pass
    return []


def find_affected_plugins(staged_files: list[str]) -> set[str]:
    """Return affected plugin names from plugins/<name>/ paths in staged files."""
    plugins = set()
    for f in staged_files:
        match = re.match(r"plugins/([^/]+)/", f)
        if match:
            plugins.add(match.group(1))
    return plugins


def check_plugin_version(git_root: str, plugin_name: str) -> list[str]:
    """Check whether plugin.json version appears in the plugin and root READMEs.

    Returns:
        List of error messages (empty if all OK).
    """
    errors = []
    plugin_dir = os.path.join(git_root, "plugins", plugin_name)

    # Read plugin.json.
    plugin_json_path = os.path.join(plugin_dir, ".claude-plugin", "plugin.json")
    if not os.path.exists(plugin_json_path):
        return []  # No plugin.json means there is nothing to validate.

    try:
        with open(plugin_json_path) as f:
            plugin_data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []

    version = plugin_data.get("version", "")
    if not version:
        return []

    # 1) Check the plugin README.md changelog.
    readme_path = os.path.join(plugin_dir, "README.md")
    if not os.path.exists(readme_path):
        errors.append(f"{plugin_name}: README.md missing (plugin.json v{version})")
    else:
        try:
            with open(readme_path) as f:
                readme_content = f.read()
            version_pattern = re.compile(rf"##\s*v?{re.escape(version)}\b")
            if not version_pattern.search(readme_content):
                errors.append(
                    f"{plugin_name}: plugin.json v{version} changelog not found in README.md"
                )
        except OSError:
            pass

    # 2) Check the root README.md version table.
    root_readme_path = os.path.join(git_root, "README.md")
    if os.path.exists(root_readme_path):
        try:
            with open(root_readme_path) as f:
                root_content = f.read()
            # Check version equality in a "| plugin-name | x.y.z |" row.
            table_pattern = re.compile(
                rf"\|\s*{re.escape(plugin_name)}\s*\|\s*{re.escape(version)}\s*\|"
            )
            if not table_pattern.search(root_content):
                # First determine whether the plugin appears in the table.
                exists_pattern = re.compile(
                    rf"\|\s*{re.escape(plugin_name)}\s*\|\s*[\d.]+\s*\|"
                )
                if exists_pattern.search(root_content):
                    errors.append(
                        f"{plugin_name}: root README.md table version mismatch (expected v{version})"
                    )
                else:
                    errors.append(
                        f"{plugin_name}: not listed in root README.md plugin table"
                    )
        except OSError:
            pass

    # 3) Check marketplace.json registration.
    marketplace_path = os.path.join(git_root, ".claude-plugin", "marketplace.json")
    if os.path.exists(marketplace_path):
        try:
            with open(marketplace_path) as f:
                marketplace_data = json.load(f)
            plugins_list = marketplace_data.get("plugins", [])
            if not any(p.get("name") == plugin_name for p in plugins_list):
                errors.append(
                    f"{plugin_name}: not registered in .claude-plugin/marketplace.json"
                )
        except (json.JSONDecodeError, OSError):
            pass

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

        if not is_git_commit_command(command):
            print(json.dumps({}))
            sys.exit(0)

        git_root = get_git_root()
        if not git_root:
            print(json.dumps({}))
            sys.exit(0)

        staged_files = get_staged_files(git_root)
        if not staged_files:
            print(json.dumps({}))
            sys.exit(0)

        affected_plugins = find_affected_plugins(staged_files)
        if not affected_plugins:
            print(json.dumps({}))
            sys.exit(0)

        # Validate each plugin.
        errors = []
        for plugin_name in sorted(affected_plugins):
            plugin_errors = check_plugin_version(git_root, plugin_name)
            errors.extend(plugin_errors)

        if errors:
            reason = "[WARN] README changelog missing:\n" + "\n".join(
                f"  - {e}" for e in errors
            )
            print(json.dumps({"decision": "block", "reason": reason}))
        else:
            print(json.dumps({}))

    except Exception:
        print(json.dumps({}))

    sys.exit(0)


if __name__ == "__main__":
    main()
