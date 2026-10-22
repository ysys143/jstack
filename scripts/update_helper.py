#!/usr/bin/env python3
"""
Helper script for updating the model database.

This script provides utilities to help with the update process:
- Check current database statistics
- Validate database structure
- Generate update report template
"""

import sys
from datetime import date
from pathlib import Path


def load_database():
    """Load the current model database."""
    try:
        sys.path.insert(0, str(Path(__file__).parent / "hooks"))
        from models_database import (
            CURRENT_MODELS,
            DEPRECATED_MODELS,
            DEPRECATED_PATTERNS,
        )

        return CURRENT_MODELS, DEPRECATED_MODELS, DEPRECATED_PATTERNS
    except ImportError as e:
        print(f"Error loading database: {e}")
        sys.exit(1)


def show_statistics():
    """Show current database statistics."""
    current, deprecated, patterns = load_database()

    print("=" * 60)
    print("Model Database Statistics")
    print("=" * 60)
    print(f"\nCurrent Models: {len(current)}")

    # Group by provider
    providers = {}
    for model_name, info in current.items():
        provider = info.provider
        providers[provider] = providers.get(provider, 0) + 1

    print("\nBy Provider:")
    for provider in sorted(providers.keys()):
        print(f"  - {provider}: {providers[provider]}")

    print(f"\nDeprecated Models: {len(deprecated)}")

    # Group deprecated by provider
    dep_providers = {}
    for model_name, info in deprecated.items():
        provider = info.provider
        dep_providers[provider] = dep_providers.get(provider, 0) + 1

    print("\nBy Provider:")
    for provider in sorted(dep_providers.keys()):
        print(f"  - {provider}: {dep_providers[provider]}")

    print(f"\nDeprecated Patterns: {len(patterns)}")
    print("\nPatterns:")
    for pattern, replacement, provider in patterns:
        print(f"  - {pattern.pattern} -> {replacement} ({provider})")

    print("\n" + "=" * 60)


def validate_database():
    """Validate database structure and integrity."""
    current, deprecated, _ = load_database()

    print("=" * 60)
    print("Database Validation")
    print("=" * 60)

    issues = []
    warnings = []

    # Check for duplicates
    all_models = set(current.keys())
    deprecated_models = set(deprecated.keys())

    overlap = all_models & deprecated_models
    if overlap:
        issues.append(f"Models in both CURRENT and DEPRECATED: {overlap}")

    # Check deprecated models have replacements
    for model_name, info in deprecated.items():
        if not info.replacement:
            issues.append(f"Deprecated model '{model_name}' has no replacement")

    # Check replacements exist in current models
    for model_name, info in deprecated.items():
        if info.replacement and info.replacement not in current:
            issues.append(
                f"Replacement '{info.replacement}' for '{model_name}' not in CURRENT_MODELS"
            )

    # NEW: Check for stale minor versions
    stale_versions = detect_stale_versions(current)
    if stale_versions:
        warnings.append("\n[WARN] Potential stale minor versions detected:")
        for provider, versions_info in stale_versions.items():
            warnings.append(f"\n  {provider}:")
            warnings.append(f"    Current major: {versions_info['current_major']}")
            warnings.append(
                f"    Old versions still in CURRENT: {versions_info['old_versions']}"
            )
            warnings.append("    Recommendation: Move old versions to DEPRECATED")

    if issues:
        print("\n[ERROR] Critical issues found:")
        for issue in issues:
            print(f"  - {issue}")
        if warnings:
            for warning in warnings:
                print(warning)
        return False
    elif warnings:
        for warning in warnings:
            print(warning)
        print("\n[WARN] Validation passed with warnings")
        return True
    else:
        print("\n[OK] No issues found")
        return True


def detect_stale_versions(current_models):
    """
    Detect potentially stale minor versions.

    Example: If glm-5 exists, glm-4.x should probably be deprecated.
    """
    import re

    stale = {}

    # Group models by provider and base name
    by_provider = {}
    for model_name, info in current_models.items():
        provider = info.provider
        if provider not in by_provider:
            by_provider[provider] = []
        by_provider[provider].append(model_name)

    # Check each provider
    for provider, models in by_provider.items():
        # Extract version patterns
        version_families = {}

        for model in models:
            # Try to extract base name and version
            # Examples: glm-4.5 -> (glm, 4.5), gpt-5 -> (gpt, 5)
            match = re.match(r"^([a-z-]+?)[-]?(\d+(?:\.\d+)?)(?:-.*)?$", model)
            if match:
                base_name = match.group(1)
                version = match.group(2)

                if base_name not in version_families:
                    version_families[base_name] = []
                version_families[base_name].append((version, model))

        # Check for stale versions
        for base_name, versions in version_families.items():
            if len(versions) < 2:
                continue

            # Parse major versions
            major_versions = {}
            for version_str, model_name in versions:
                try:
                    # Get major version (e.g., 4 from 4.5)
                    major = int(float(version_str))
                    if major not in major_versions:
                        major_versions[major] = []
                    major_versions[major].append(model_name)
                except ValueError:
                    continue

            # If we have multiple major versions
            if len(major_versions) > 1:
                max_major = max(major_versions.keys())
                old_majors = [m for m in major_versions.keys() if m < max_major]

                if old_majors:
                    old_models = []
                    for old_major in old_majors:
                        old_models.extend(major_versions[old_major])

                    stale[f"{provider}/{base_name}"] = {
                        "current_major": max_major,
                        "old_versions": old_models,
                    }

    return stale


def generate_update_template():
    """Generate a template for documenting updates."""
    template = f"""
# Model Database Update - {date.today()}

## Research Findings

### OpenAI
- Latest models:
  -
- Deprecated:
  -

### Anthropic
- Latest models:
  -
- Deprecated:
  -

### Google
- Latest models:
  -
- Deprecated:
  -

## Changes to Make

### Add to CURRENT_MODELS
```python

```

### Move to DEPRECATED_MODELS
```python

```

### Update Patterns (if needed)
```python

```

## New Version Number
Current: 1.0.0
New:

## Commit Message
```
feat(model-checker): Update model database vX.Y.Z

- Add: ...
- Deprecate: ...
```
"""

    output_file = Path(__file__).parent / f"update_notes_{date.today()}.md"
    output_file.write_text(template)
    print(f"\nUpdate template saved to: {output_file}")


def list_current_models():
    """List all current models."""
    current, _, _ = load_database()

    print("=" * 60)
    print("Current Models")
    print("=" * 60)

    by_provider = {}
    for model_name, info in current.items():
        if info.provider not in by_provider:
            by_provider[info.provider] = []
        by_provider[info.provider].append(model_name)

    for provider in sorted(by_provider.keys()):
        print(f"\n{provider}:")
        for model in sorted(by_provider[provider]):
            print(f"  - {model}")


def list_deprecated_models():
    """List all deprecated models with replacements."""
    _, deprecated, _ = load_database()

    print("=" * 60)
    print("Deprecated Models")
    print("=" * 60)

    by_provider = {}
    for model_name, info in deprecated.items():
        if info.provider not in by_provider:
            by_provider[info.provider] = []
        by_provider[info.provider].append(
            (model_name, info.replacement, info.deprecated_date)
        )

    for provider in sorted(by_provider.keys()):
        print(f"\n{provider}:")
        for model, replacement, dep_date in sorted(by_provider[provider]):
            date_str = dep_date.strftime("%Y-%m-%d") if dep_date else "unknown"
            print(f"  - {model} -> {replacement} (since {date_str})")


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Model Database Update Helper")
        print("\nUsage:")
        print("  python3 update_helper.py stats       - Show database statistics")
        print("  python3 update_helper.py validate    - Validate database integrity")
        print("  python3 update_helper.py template    - Generate update template")
        print("  python3 update_helper.py current     - List current models")
        print("  python3 update_helper.py deprecated  - List deprecated models")
        sys.exit(0)

    command = sys.argv[1]

    if command == "stats":
        show_statistics()
    elif command == "validate":
        validate_database()
    elif command == "template":
        generate_update_template()
    elif command == "current":
        list_current_models()
    elif command == "deprecated":
        list_deprecated_models()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
