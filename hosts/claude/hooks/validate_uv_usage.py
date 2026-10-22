#!/usr/bin/env python3
"""PreToolUse hook to enforce uv usage instead of pip.

Blocks pip/pip3/pipx commands and suggests uv alternatives.
Checks .venv existence before uv pip commands.
Supports per-project configuration via pyproject.toml.
"""

import json
import os
import re
import sys

# Map pip command patterns to uv alternatives.
PIP_ALTERNATIVES = {
    "install": ("uv add", "uv pip install"),
    "uninstall": ("uv remove", "uv pip uninstall"),
    "list": ("uv pip list",),
    "freeze": ("uv pip freeze",),
    "show": ("uv pip show",),
    "check": ("uv pip check",),
    "download": ("uv pip download",),
    "wheel": ("uv pip wheel",),
    "cache": ("uv cache",),
    "config": ("uv pip config",),
}

# Commands that are always blocked (without a direct uv alternative).
BLOCKED_COMMANDS = {
    "pipx": "Replace pipx with uv tool. Example: uv tool install <package>",
}


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


def is_hook_disabled() -> bool:
    """Check if hook is disabled via pyproject.toml."""
    try:
        root = get_project_root()
        if not root:
            return False

        pyproject_path = os.path.join(root, "pyproject.toml")
        if not os.path.exists(pyproject_path):
            return False

        # Simple TOML parsing for [tool.claude-hooks]
        with open(pyproject_path) as f:
            content = f.read()

        # Look for [tool.claude-hooks] section
        if "[tool.claude-hooks]" in content:
            section_start = content.index("[tool.claude-hooks]")
            section_end = content.find("\n[", section_start + 1)
            section = (
                content[section_start:section_end]
                if section_end != -1
                else content[section_start:]
            )

            if "enforce_uv = false" in section or 'enforce_uv = "false"' in section:
                return True

        return False
    except Exception:
        return False


def find_venv_path() -> str | None:
    """Find .venv directory relative to project root."""
    root = get_project_root()
    if root:
        venv_path = os.path.join(root, ".venv")
        if os.path.isdir(venv_path):
            return venv_path
    return None


def is_venv_check_disabled() -> bool:
    """Check if venv check is disabled via pyproject.toml."""
    try:
        root = get_project_root()
        if not root:
            return False

        pyproject_path = os.path.join(root, "pyproject.toml")
        if not os.path.exists(pyproject_path):
            return False

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

            if (
                "enforce_venv_check = false" in section
                or 'enforce_venv_check = "false"' in section
            ):
                return True

        return False
    except Exception:
        return False


def check_uv_pip_without_venv(command: str) -> str | None:
    """Check if uv pip command is used without .venv existing.

    Returns a warning message if .venv is missing, None otherwise.
    """
    exec_command = extract_executable_commands(command)

    # Detect uv pip subcommands (install, uninstall, list, freeze, show, etc.)
    uv_pip_match = re.search(r"\buv\s+pip\s+(\w+)", exec_command, re.IGNORECASE)
    if not uv_pip_match:
        return None

    subcommand = uv_pip_match.group(1).lower()

    # Read-only subcommands don't need venv check
    read_only = {"list", "freeze", "show", "check"}
    if subcommand in read_only:
        return None

    # Check if .venv exists
    if find_venv_path() is not None:
        return None

    return (
        "[WARN] .venv not found - run `uv venv` first\n"
        "\n"
        f"`uv pip {subcommand}` requires a virtual environment.\n"
        "No `.venv` directory found in this project.\n"
        "\n"
        "**How to fix:**\n"
        "```bash\n"
        "# Option 1: Create venv, then use uv pip\n"
        "uv venv\n"
        f"uv pip {subcommand} <packages>\n"
        "\n"
        "# Option 2: Use uv add (auto-creates venv + updates pyproject.toml)\n"
        "uv add <packages>\n"
        "\n"
        "# Option 3: Use uv sync (syncs from pyproject.toml, auto-creates venv)\n"
        "uv sync\n"
        "```\n"
        "\n"
        "[INFO] Recommended: `uv add` auto-creates venv and updates pyproject.toml.\n"
        "See: https://docs.astral.sh/uv/pip/environments/\n"
    )


def extract_executable_commands(command: str) -> str:
    """Extract only executable command positions, excluding quoted/heredoc content.

    Returns a cleaned command string where quoted strings and heredocs
    are replaced with placeholders, so only actual commands are checked.
    """
    result = command

    # 1. Remove heredoc content: <<'EOF' ... EOF, <<"EOF" ... EOF, <<EOF ... EOF
    # This handles multi-line heredocs in the command
    heredoc_pattern = r"<<-?\s*['\"]?(\w+)['\"]?.*?(?:^|\n)\1(?:\s|$)"
    result = re.sub(heredoc_pattern, " __HEREDOC__ ", result, flags=re.DOTALL)

    # 2. Remove $(...) subshells that contain heredoc (common git commit pattern)
    # e.g., git commit -m "$(cat <<'EOF' ... EOF)"
    subshell_pattern = r"\$\([^)]*<<[^)]*\)"
    result = re.sub(subshell_pattern, " __SUBSHELL__ ", result, flags=re.DOTALL)

    # 3. Remove single-quoted strings (these are literal, never commands)
    result = re.sub(r"'[^']*'", " __SQUOTE__ ", result)

    # 4. Remove double-quoted strings (arguments, not commands)
    # Be careful: nested quotes are tricky, use non-greedy
    result = re.sub(r'"[^"]*"', " __DQUOTE__ ", result)

    return result


def find_pip_commands(command: str) -> list[dict]:
    """Find all pip-related commands that should be blocked.

    Only detects pip/pip3/pipx when they appear in executable positions,
    not inside quoted strings, heredocs, or as arguments to other commands.
    """
    detected = []

    # Skip if it's already a uv command
    if command.strip().startswith("uv "):
        return []

    # Extract only executable parts (remove quoted content, heredocs)
    exec_command = extract_executable_commands(command)

    # Pattern 1: python -m pip / python3 -m pip
    python_pip_match = re.search(
        r"\b(python3?)\s+-m\s+pip\s+(\w+)", exec_command, re.IGNORECASE
    )
    if python_pip_match:
        subcommand = python_pip_match.group(2).lower()
        alternatives = PIP_ALTERNATIVES.get(subcommand, ("uv pip " + subcommand,))
        detected.append(
            {
                "original": f"{python_pip_match.group(1)} -m pip {subcommand}",
                "alternatives": alternatives,
                "type": "python_module",
            }
        )

    # Pattern 2: Direct pip/pip3 commands (not preceded by 'uv ')
    for subcommand, alternatives in PIP_ALTERNATIVES.items():
        # Match pip <subcommand> or pip3 <subcommand>
        pattern = rf"(?<![a-zA-Z])(pip3?)\s+{subcommand}\b"
        for match in re.finditer(pattern, exec_command, re.IGNORECASE):
            start = match.start()
            # Check if preceded by 'uv '
            prefix = exec_command[max(0, start - 4) : start].lower()
            if "uv " not in prefix:
                detected.append(
                    {
                        "original": f"{match.group(1)} {subcommand}",
                        "alternatives": alternatives,
                        "type": "direct_pip",
                    }
                )

    # Pattern 3: pipx commands
    pipx_match = re.search(r"\bpipx\s+(\w+)", exec_command, re.IGNORECASE)
    if pipx_match:
        subcommand = pipx_match.group(1).lower()
        uv_alt = {
            "install": "uv tool install",
            "uninstall": "uv tool uninstall",
            "run": "uv tool run (or uvx)",
            "list": "uv tool list",
            "upgrade": "uv tool upgrade",
        }.get(subcommand, f"uv tool {subcommand}")
        detected.append(
            {
                "original": f"pipx {subcommand}",
                "alternatives": (uv_alt,),
                "type": "pipx",
            }
        )

    # Pattern 4: Bare pip without subcommand (e.g., pip --version)
    if re.search(r"(?<![a-zA-Z])pip3?\s+--", exec_command, re.IGNORECASE):
        bare_match = re.search(
            r"(?<![a-zA-Z])(pip3?)\s+(--\w+)", exec_command, re.IGNORECASE
        )
        if bare_match:
            detected.append(
                {
                    "original": f"{bare_match.group(1)} {bare_match.group(2)}",
                    "alternatives": (f"uv pip {bare_match.group(2)}",),
                    "type": "bare_pip",
                }
            )

    return detected


def format_block_message(detected: list[dict]) -> str:
    """Format a helpful block message with alternatives."""
    alternatives_text = []
    for d in detected:
        alts = " or ".join(f"`{a}`" for a in d["alternatives"])
        alternatives_text.append(f"• `{d['original']}` → {alts}")

    return f"""[WARN] pip/pip3/pipx are prohibited - use uv

This project uses **uv** as its package manager.

**Alternative commands:**
{chr(10).join(alternatives_text)}

**[NOTE] Common uv commands:**
```bash
uv sync                 # Sync dependencies from pyproject.toml
uv add <pkg>            # Add a package and update pyproject.toml
uv remove <pkg>         # Remove a package
uv pip install <pkg>    # pip-compatible install without changing pyproject.toml
uv pip list             # List installed packages
uv run <cmd>            # Run a command in the virtual environment
uv tool install <pkg>   # Install a CLI tool globally (pipx replacement)
uvx <pkg>               # Run a tool once (pipx run replacement)
```

[DOC] https://docs.astral.sh/uv/
"""


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

        # Check if disabled via pyproject.toml
        if is_hook_disabled():
            print(json.dumps({}))
            sys.exit(0)

        # Find pip commands
        detected = find_pip_commands(command)

        if detected:
            result = {
                "decision": "block",
                "reason": format_block_message(detected),
            }
            print(json.dumps(result))
            return

        # Check uv pip commands for .venv existence
        if not is_venv_check_disabled():
            venv_warning = check_uv_pip_without_venv(command)
            if venv_warning:
                result = {
                    "decision": "block",
                    "reason": venv_warning,
                }
                print(json.dumps(result))
                return

        print(json.dumps({}))

    except Exception as e:
        # On error, allow operation (fail-open)
        error_output = {"systemMessage": f"[python-convention] Hook error: {e}"}
        print(json.dumps(error_output))

    sys.exit(0)


if __name__ == "__main__":
    main()
