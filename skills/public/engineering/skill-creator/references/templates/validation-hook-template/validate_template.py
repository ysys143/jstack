#!/usr/bin/env python3
"""
Validation Hook Template

Purpose: {What this hook validates}
Trigger: {When it runs - pre_commit, post_commit, etc.}
Author: <your name or organization>
"""

import os
import sys
import json
from pathlib import Path
from typing import Dict, List, Any, Optional


class ValidationError:
    """Represents a validation error"""

    def __init__(
        self,
        rule: str,
        message: str,
        location: str,
        fix: str,
        severity: str = "error",
    ):
        self.rule = rule
        self.message = message
        self.location = location
        self.fix = fix
        self.severity = severity

    def __str__(self) -> str:
        prefix = "[FAIL]" if self.severity == "error" else "[WARN]"
        return (
            f"{prefix} {self.message}\n  Location: {self.location}\n  Fix: {self.fix}"
        )


class Validator:
    """Base validator class"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.errors: List[ValidationError] = []
        self.warnings: List[ValidationError] = []

    @property
    def severity(self) -> str:
        """Get configured severity level"""
        return self.config.get("severity", "error")

    @property
    def auto_fix_enabled(self) -> bool:
        """Check if auto-fix is enabled"""
        return self.config.get("auto_fix", False)

    @property
    def rules(self) -> Dict[str, Any]:
        """Get validation rules configuration"""
        return self.config.get("rules", {})

    def validate(self, target_path: Path) -> bool:
        """
        Main validation entry point

        Args:
            target_path: Path to validate

        Returns:
            True if validation passed, False otherwise
        """
        # TODO: Implement validation logic
        # Example:
        # self.check_file_exists(target_path)
        # self.check_schema(target_path)
        # self.check_naming_conventions(target_path)

        return len(self.errors) == 0

    def add_error(
        self,
        rule: str,
        message: str,
        location: str,
        fix: str,
        severity: Optional[str] = None,
    ) -> None:
        """Add a validation error"""
        error = ValidationError(
            rule=rule,
            message=message,
            location=location,
            fix=fix,
            severity=severity or self.severity,
        )

        if error.severity == "error":
            self.errors.append(error)
        else:
            self.warnings.append(error)

    def check_file_exists(self, file_path: Path) -> bool:
        """Example validation: Check if file exists"""
        if not file_path.exists():
            self.add_error(
                rule="file_exists",
                message=f"Required file not found: {file_path.name}",
                location=str(file_path),
                fix=f"Create file: {file_path}",
            )
            return False
        return True

    def check_json_schema(self, json_path: Path, required_fields: List[str]) -> bool:
        """Example validation: Check JSON schema"""
        if not self.check_file_exists(json_path):
            return False

        try:
            with open(json_path) as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            self.add_error(
                rule="json_syntax",
                message=f"Invalid JSON syntax in {json_path.name}",
                location=f"{json_path}:{e.lineno}",
                fix="Fix JSON syntax error",
            )
            return False

        # Check required fields
        for field in required_fields:
            if field not in data:
                self.add_error(
                    rule="required_field",
                    message=f"Missing required field: {field}",
                    location=str(json_path),
                    fix=f'Add "{field}" field to JSON',
                )

        return len(self.errors) == 0

    def check_naming_convention(
        self, name: str, pattern: str, description: str
    ) -> bool:
        """Example validation: Check naming convention"""
        import re

        if not re.match(pattern, name):
            self.add_error(
                rule="naming_convention",
                message=f"Invalid {description}: {name}",
                location=name,
                fix=f"Use pattern: {pattern}",
            )
            return False
        return True

    def auto_fix(self) -> bool:
        """
        Attempt to automatically fix validation errors

        Returns:
            True if all errors were fixed, False otherwise
        """
        if not self.auto_fix_enabled:
            return False

        # TODO: Implement auto-fix logic for each error type
        # Example:
        # for error in self.errors:
        #     if error.rule == "missing_field":
        #         self.fix_missing_field(error)

        return False

    def report(self) -> None:
        """Output validation results"""
        if self.errors:
            print("\n[FAIL] Validation failed:\n")
            for error in self.errors:
                print(f"  - {error.message}")
                print(f"    Location: {error.location}")
                print(f"    Fix: {error.fix}\n")

        if self.warnings:
            print("\n[WARN] Warnings:\n")
            for warning in self.warnings:
                print(f"  - {warning.message}")
                print(f"    Location: {warning.location}")
                print(f"    Fix: {warning.fix}\n")

        if not self.errors and not self.warnings:
            print("[OK] Validation passed")


def load_hook_config() -> Dict[str, Any]:
    """
    Load hook configuration.

    hooks.json only wires a matcher to a command in the real schema — it
    has no per-hook `name`/`config` field to read settings from. So this
    reads, in priority order: environment variables, then this repo's own
    pyproject.toml under [tool.claude-hooks], then hard-coded defaults.
    """
    config: Dict[str, Any] = {}

    pyproject_path = Path("pyproject.toml")
    if pyproject_path.exists():
        try:
            import tomllib

            with open(pyproject_path, "rb") as f:
                data = tomllib.load(f)
            config = dict(data.get("tool", {}).get("claude-hooks", {}))
        except Exception:
            config = {}

    env_severity = os.environ.get("HOOK_SEVERITY")
    if env_severity:
        config["severity"] = env_severity

    env_auto_fix = os.environ.get("HOOK_AUTO_FIX")
    if env_auto_fix is not None:
        config["auto_fix"] = env_auto_fix.strip().lower() in ("1", "true", "yes")

    return config


def read_hook_payload() -> Dict[str, Any]:
    """
    Read the Claude Code hook JSON payload from stdin.

    PreToolUse/PostToolUse hooks receive a JSON payload on stdin (e.g.
    {"tool_input": {"file_path": ...}, ...}), not as argv — hooks.json's
    command line carries no extra arguments.
    """
    if sys.stdin.isatty():
        return {}

    try:
        raw = sys.stdin.read()
    except Exception:
        return {}

    if not raw.strip():
        return {}

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def main():
    """Main entry point"""
    # Load configuration
    config = load_hook_config()

    # Get target path: an explicit argv wins (manual/CLI use); otherwise
    # fall back to tool_input.file_path in the hook's stdin JSON payload;
    # otherwise the current directory.
    if len(sys.argv) > 1:
        target = Path(sys.argv[1])
    else:
        payload = read_hook_payload()
        file_path = payload.get("tool_input", {}).get("file_path")
        target = Path(file_path) if file_path else Path.cwd()

    # Run validation
    validator = Validator(config)
    is_valid = validator.validate(target)

    # Try auto-fix if enabled
    if not is_valid and validator.auto_fix_enabled:
        if validator.auto_fix():
            # Re-validate after auto-fix
            validator = Validator(config)
            is_valid = validator.validate(target)
            if is_valid:
                print("[OK] Auto-fix successful")

    # Report results
    validator.report()

    # Exit with appropriate code
    sys.exit(0 if is_valid else 1)


if __name__ == "__main__":
    main()
