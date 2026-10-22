#!/usr/bin/env python3
"""PostToolUse hook to run ruff check after Write/Edit on Python files.

Features:
- Runs ruff check on modified Python files
- Categorizes errors into auto-fixable and manual-fix-required
- Optionally runs pyright type checking
- Provides actionable feedback for Claude to self-correct
- Supports per-project configuration via pyproject.toml
"""

import json
import os
import subprocess
import sys


def get_project_root() -> str | None:
    """Find project root by looking for pyproject.toml or .git."""
    cwd = os.getcwd()
    current = cwd
    while current != "/":
        if os.path.exists(os.path.join(current, "pyproject.toml")):
            return current
        if os.path.exists(os.path.join(current, ".git")):
            return current
        current = os.path.dirname(current)
    return cwd


def get_config() -> dict:
    """Read hook configuration from pyproject.toml."""
    config = {
        "enabled": True,
        "run_pyright": False,  # Disabled by default to avoid duplicating pyright-lsp.
        "show_fixable": True,
        "ignore_rules": [],
    }

    try:
        root = get_project_root()
        if not root:
            return config

        pyproject_path = os.path.join(root, "pyproject.toml")
        if not os.path.exists(pyproject_path):
            return config

        with open(pyproject_path) as f:
            content = f.read()

        # Simple TOML parsing for [tool.claude-hooks]
        if "[tool.claude-hooks]" in content:
            section_start = content.index("[tool.claude-hooks]")
            section_end = content.find("\n[", section_start + 1)
            section = (
                content[section_start:section_end]
                if section_end != -1
                else content[section_start:]
            )

            if "ruff_check = false" in section or 'ruff_check = "false"' in section:
                config["enabled"] = False
            if "pyright_check = true" in section or 'pyright_check = "true"' in section:
                config["run_pyright"] = True

        return config
    except Exception:
        return config


def get_python_file_from_input(tool_input: dict) -> str | None:
    """Extract Python file path from tool input."""
    file_path = tool_input.get("file_path", "")
    if file_path and (file_path.endswith(".py") or file_path.endswith(".pyi")):
        return file_path
    return None


def parse_ruff_output(output: str) -> tuple[list[dict], list[dict]]:
    """Parse ruff output into fixable and non-fixable errors."""
    fixable = []
    non_fixable = []

    # Auto-fixable rule codes (common ones)
    fixable_codes = {
        "I001",
        "I002",  # isort
        "F401",  # unused import
        "F841",  # unused variable
        "E401",  # multiple imports
        "E701",
        "E702",
        "E703",  # statement issues
        "W291",
        "W292",
        "W293",  # whitespace
        "UP",  # pyupgrade (all UP codes)
        "COM812",  # trailing comma
        "Q",  # quotes (all Q codes)
    }

    for line in output.strip().split("\n"):
        if not line.strip():
            continue

        # Parse format: file:line:col: CODE message
        # Example: test.py:10:1: F401 `os` imported but unused
        parts = line.split(": ", 1)
        if len(parts) < 2:
            continue

        location = parts[0]
        rest = parts[1] if len(parts) > 1 else ""

        # Extract code
        code_match = rest.split(" ", 1)
        code = code_match[0] if code_match else ""
        message = code_match[1] if len(code_match) > 1 else rest

        error_info = {
            "location": location,
            "code": code,
            "message": message,
            "full": line,
        }

        # Check if fixable
        is_fixable = any(code.startswith(fc) for fc in fixable_codes)
        if is_fixable:
            fixable.append(error_info)
        else:
            non_fixable.append(error_info)

    return fixable, non_fixable


def run_ruff_check(file_path: str) -> tuple[bool, str]:
    """Run ruff check on a file. Returns (passed, message)."""
    try:
        result = subprocess.run(
            ["ruff", "check", "--output-format=concise", file_path],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode == 0:
            return True, ""

        fixable, non_fixable = parse_ruff_output(result.stdout)

        # Build detailed feedback
        feedback_parts = ["[SCAN] **ruff check errors found**\n"]

        if fixable:
            feedback_parts.append("**[FIX] Automatically fixable (use --fix):**")
            for err in fixable[:5]:  # Limit to 5
                feedback_parts.append(
                    f"  • `{err['code']}` {err['location']}: {err['message']}"
                )
            if len(fixable) > 5:
                feedback_parts.append(f"  ... and {len(fixable) - 5} more")
            feedback_parts.append("")

        if non_fixable:
            feedback_parts.append("**[EDIT] Manual changes required:**")
            for err in non_fixable[:5]:  # Limit to 5
                feedback_parts.append(
                    f"  • `{err['code']}` {err['location']}: {err['message']}"
                )
            if len(non_fixable) > 5:
                feedback_parts.append(f"  ... and {len(non_fixable) - 5} more")
            feedback_parts.append("")

        feedback_parts.append("[HINT] Fix the errors, then try again.")

        return False, "\n".join(feedback_parts)

    except FileNotFoundError:
        return True, ""  # ruff not installed, skip silently
    except subprocess.TimeoutExpired:
        return True, ""  # timeout, skip
    except Exception:
        return True, ""  # error, skip


def run_pyright_check(file_path: str) -> tuple[bool, str]:
    """Run pyright type check on a file. Returns (passed, message)."""
    try:
        result = subprocess.run(
            ["pyright", "--outputjson", file_path],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode == 0:
            return True, ""

        # Parse JSON output
        try:
            data = json.loads(result.stdout)
            diagnostics = data.get("generalDiagnostics", [])

            if not diagnostics:
                return True, ""

            errors = [d for d in diagnostics if d.get("severity") == 1]  # 1 = error

            if not errors:  # Only block on errors, not warnings
                return True, ""

            feedback_parts = ["\n[SCAN] **pyright type errors:**"]
            for err in errors[:5]:
                line = err.get("range", {}).get("start", {}).get("line", 0) + 1
                msg = err.get("message", "")
                rule = err.get("rule", "")
                feedback_parts.append(
                    f"  • Line {line}: {msg}" + (f" [{rule}]" if rule else "")
                )

            if len(errors) > 5:
                feedback_parts.append(f"  ... and {len(errors) - 5} more errors")

            return False, "\n".join(feedback_parts)

        except json.JSONDecodeError:
            # Fallback to plain output
            if "error" in result.stdout.lower():
                return False, f"\n[SCAN] **pyright errors:**\n{result.stdout[:500]}"
            return True, ""

    except FileNotFoundError:
        return True, ""  # pyright not installed
    except subprocess.TimeoutExpired:
        return True, ""
    except Exception:
        return True, ""


def main():
    try:
        input_data = json.load(sys.stdin)

        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input", {})

        # Only process Write/Edit tools
        if tool_name not in ("Write", "Edit"):
            print(json.dumps({}))
            sys.exit(0)

        # Check if it's a Python file
        file_path = get_python_file_from_input(tool_input)
        if not file_path:
            print(json.dumps({}))
            sys.exit(0)

        # Check if file exists
        if not os.path.exists(file_path):
            print(json.dumps({}))
            sys.exit(0)

        # Get configuration
        config = get_config()
        if not config["enabled"]:
            print(json.dumps({}))
            sys.exit(0)

        # Collect all errors
        all_messages = []

        # Run ruff check
        ruff_passed, ruff_message = run_ruff_check(file_path)
        if not ruff_passed:
            all_messages.append(ruff_message)

        # Optionally run pyright
        if config["run_pyright"]:
            pyright_passed, pyright_message = run_pyright_check(file_path)
            if not pyright_passed:
                all_messages.append(pyright_message)

        if all_messages:
            # Use exit code 2 to feed error back to Claude
            combined_message = "\n".join(all_messages)
            print(combined_message, file=sys.stderr)
            sys.exit(2)
        else:
            print(json.dumps({}))
            sys.exit(0)

    except Exception:
        # On error, allow operation (fail-open)
        print(json.dumps({}))
        sys.exit(0)


if __name__ == "__main__":
    main()
