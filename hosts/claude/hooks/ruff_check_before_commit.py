#!/usr/bin/env python3
"""PreToolUse hook to run ruff format + check before git commit.

Features:
1. Formats staged Python files with ruff format
2. Re-stages formatted files
3. Runs ruff check with detailed error reporting
4. Optionally runs pyright type check
5. Blocks commit if errors remain
6. Supports per-project configuration via pyproject.toml
"""

import json
import os
import re
import subprocess
import sys


def is_git_commit_command(command: str) -> bool:
    """Check if command is a git commit."""
    return bool(re.search(r"\bgit\s+commit\b", command, re.IGNORECASE))


def get_git_root() -> str | None:
    """Get git repository root directory."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except Exception:
        return None


def get_config() -> dict:
    """Read hook configuration from pyproject.toml."""
    config = {
        "enabled": True,
        "run_pyright": False,
        "auto_format": True,
    }

    try:
        root = get_git_root()
        if not root:
            return config

        pyproject_path = os.path.join(root, "pyproject.toml")
        if not os.path.exists(pyproject_path):
            return config

        with open(pyproject_path) as f:
            content = f.read()

        if "[tool.claude-hooks]" in content:
            section_start = content.index("[tool.claude-hooks]")
            section_end = content.find("\n[", section_start + 1)
            section = (
                content[section_start:section_end]
                if section_end != -1
                else content[section_start:]
            )

            if "pre_commit_check = false" in section:
                config["enabled"] = False
            if "pyright_check = true" in section:
                config["run_pyright"] = True
            if "auto_format = false" in section:
                config["auto_format"] = False

        return config
    except Exception:
        return config


def get_staged_python_files() -> list[str]:
    """Get list of staged Python files with absolute paths."""
    try:
        git_root = get_git_root()
        if not git_root:
            return []

        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=git_root,
        )
        if result.returncode != 0:
            return []

        files = result.stdout.strip().split("\n")
        return [
            os.path.join(git_root, f)
            for f in files
            if f and (f.endswith(".py") or f.endswith(".pyi"))
        ]
    except Exception:
        return []


def run_ruff_format(files: list[str]) -> tuple[bool, list[str], str]:
    """Run ruff format on files. Returns (success, formatted_files, message)."""
    if not files:
        return True, [], ""

    try:
        # First, check what would be changed
        check_result = subprocess.run(
            ["ruff", "format", "--check", "--diff"] + files,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if check_result.returncode == 0:
            return True, [], ""  # No formatting needed

        # Apply formatting
        format_result = subprocess.run(
            ["ruff", "format"] + files,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if format_result.returncode == 0:
            # Count formatted files from diff output
            changed_files = []
            for line in check_result.stdout.split("\n"):
                if line.startswith("--- "):
                    # Extract filename from diff header
                    file_path = line[4:].strip()
                    if file_path.startswith("a/"):
                        file_path = file_path[2:]
                    changed_files.append(file_path)

            formatted_count = len(set(changed_files)) if changed_files else len(files)
            return True, files, f"[OK] ruff format applied to {formatted_count} files"

        return False, [], f"[WARN] ruff format failed: {format_result.stderr}"

    except FileNotFoundError:
        return True, [], ""  # ruff not installed
    except Exception as e:
        return True, [], f"[WARN] formatting error: {e}"


def restage_files(files: list[str]) -> bool:
    """Re-stage files after formatting."""
    if not files:
        return True
    try:
        result = subprocess.run(
            ["git", "add"] + files,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def run_ruff_check(files: list[str]) -> tuple[bool, str, dict]:
    """Run ruff check on files. Returns (passed, message, stats)."""
    if not files:
        return True, "", {}

    try:
        result = subprocess.run(
            ["ruff", "check", "--output-format=grouped"] + files,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode == 0:
            return True, "", {"total": 0}

        # Count errors
        error_lines = [
            line
            for line in result.stdout.strip().split("\n")
            if line.strip() and not line.startswith(" ") and ":" in line
        ]

        # Parse summary if available
        summary_match = re.search(r"Found (\d+) error", result.stdout)
        error_count = int(summary_match.group(1)) if summary_match else len(error_lines)

        # Check for fixable errors
        fixable_match = re.search(r"\[(\*|\d+) fixable", result.stdout)
        fixable_count = 0
        if fixable_match:
            if fixable_match.group(1) == "*":
                fixable_count = error_count
            else:
                fixable_count = int(fixable_match.group(1))

        stats = {
            "total": error_count,
            "fixable": fixable_count,
            "manual": error_count - fixable_count,
        }

        # Build message
        filenames = ", ".join(os.path.basename(f) for f in files[:3])
        if len(files) > 3:
            filenames += f" and {len(files) - 3} more"

        message = f"""[FAIL] **ruff check failed** - fix before committing

**Error summary:** {error_count} total ({fixable_count} automatically fixable)

```
{result.stdout[:1500]}
```

**[HINT] How to fix:**
• Automatic fix: `ruff check --fix {files[0] if len(files) == 1 else "."}`
• Checked files: {filenames}
"""
        return False, message, stats

    except FileNotFoundError:
        return True, "[WARN] ruff is not installed", {}
    except subprocess.TimeoutExpired:
        return True, "[WARN] ruff timed out", {}
    except Exception as e:
        return True, f"[WARN] ruff error: {e}", {}


def run_pyright_check(files: list[str]) -> tuple[bool, str]:
    """Run pyright type check on files."""
    if not files:
        return True, ""

    try:
        result = subprocess.run(
            ["pyright"] + files,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode == 0:
            return True, ""

        # Extract error count
        error_match = re.search(r"(\d+) error", result.stdout)
        error_count = int(error_match.group(1)) if error_match else "multiple"

        message = f"""
[FAIL] **pyright type errors** - {error_count}

```
{result.stdout[:1000]}
```
"""
        return False, message

    except FileNotFoundError:
        return True, ""  # pyright not installed
    except Exception:
        return True, ""


def main():
    try:
        input_data = json.load(sys.stdin)

        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input", {})
        command = tool_input.get("command", "")

        # Only check Bash tool
        if tool_name != "Bash":
            print(json.dumps({}))
            sys.exit(0)

        # Check if this is a git commit command
        if not is_git_commit_command(command):
            print(json.dumps({}))
            sys.exit(0)

        # Get config
        config = get_config()
        if not config["enabled"]:
            print(json.dumps({}))
            sys.exit(0)

        # Get staged Python files
        staged_files = get_staged_python_files()

        if not staged_files:
            print(json.dumps({}))
            sys.exit(0)

        messages = []

        # Step 1: Run ruff format (if enabled)
        if config["auto_format"]:
            format_success, formatted_files, format_message = run_ruff_format(
                staged_files
            )
            if format_message:
                messages.append(format_message)

            # Re-stage formatted files
            if format_success and formatted_files:
                restage_files(formatted_files)

        # Step 2: Run ruff check
        check_passed, check_message, _ = run_ruff_check(staged_files)

        # Step 3: Optionally run pyright
        pyright_passed = True
        if config["run_pyright"]:
            pyright_passed, pyright_message = run_pyright_check(staged_files)
            if pyright_message:
                messages.append(pyright_message)

        # Determine result
        if check_passed and pyright_passed:
            file_count = len(staged_files)
            success_msg = f"[OK] Python quality checks passed for {file_count} files"
            if messages:
                success_msg = "\n".join(messages) + "\n" + success_msg
            print(json.dumps({"systemMessage": success_msg}))
        else:
            all_messages = messages + [check_message] if check_message else messages
            print(
                json.dumps(
                    {
                        "decision": "block",
                        "reason": "\n".join(all_messages),
                    }
                )
            )

    except Exception as e:
        error_output = {"systemMessage": f"[python-convention] Hook error: {e}"}
        print(json.dumps(error_output))

    sys.exit(0)


if __name__ == "__main__":
    main()
