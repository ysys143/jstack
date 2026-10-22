#!/usr/bin/env python3
"""Create a fresh local marketplace containing one checked dual-host package."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('jstack_release_builder', Path(__file__).with_name('build.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
MARKETPLACE = 'jstack'


def registries():
    return {
        '.claude-plugin/marketplace.json': {'name': MARKETPLACE, 'owner': {'name': 'jstack'},
            'plugins': [{'name': 'jstack', 'source': './plugins/jstack'}]},
        '.agents/plugins/marketplace.json': {'name': MARKETPLACE, 'interface': {'displayName': 'jstack'},
            'plugins': [{'name': 'jstack', 'source': {'source': 'local', 'path': './plugins/jstack'},
                         'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'},
                         'category': 'Productivity'}]},
    }


def check(root, private_values=()):
    root = root.resolve()
    for relative, expected in registries().items():
        if json.loads((root / relative).read_text()) != expected:
            raise builder.BuildError('marketplace registry differs from the one-package contract')
    result = builder.check(root / 'plugins/jstack', private_values)
    allowed = set(registries()) | {'README.md', 'release.json'}
    for path in root.rglob('*'):
        if path.is_file() and not path.is_relative_to(root / 'plugins/jstack'):
            if path.relative_to(root).as_posix() not in allowed:
                raise builder.BuildError('unexpected release file outside the package')
    report = builder.public.inspect(root, private_values)
    if not report['passed']:
        raise builder.BuildError('release publication boundary failed: ' + json.dumps(report))
    receipt = json.loads((root / 'plugins/jstack/package-receipt.json').read_text())
    record = json.loads((root / 'release.json').read_text())
    if record != {'schemaVersion': 1, 'marketplace': MARKETPLACE, 'name': 'jstack',
                   'version': result['version'], 'sourceSha256': receipt['sourceSha256'],
                   'packageFileCount': result['files'], 'remotePublished': False}:
        raise builder.BuildError('release record is not bound to the package receipt')
    return {'passed': True, 'version': result['version'], 'marketplace': MARKETPLACE,
            'publicSkills': result['publicSkills'], 'scannedFiles': report['scannedFiles']}


def create(source, output, private_values=()):
    source, output = source.resolve(), output.absolute()
    if output.exists() or output.is_symlink():
        raise builder.BuildError('release output must not exist')
    if output.resolve().is_relative_to(source):
        raise builder.BuildError('release output must be outside the source checkout')
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.jstack-release-', dir=output.parent))
    try:
        built = builder.build(source, temporary / 'plugins/jstack', private_values)
        for relative, content in registries().items():
            builder.write_json(temporary / relative, content)
        builder.write_json(temporary / 'release.json', {'schemaVersion': 1, 'marketplace': MARKETPLACE,
            'name': 'jstack', 'version': built['version'], 'sourceSha256': built['sourceSha256'],
            'packageFileCount': built['files'], 'remotePublished': False})
        (temporary / 'README.md').write_text('''# jstack local marketplace

This directory is a generated delivery snapshot with one package for both hosts.
The source checkout and its historical records are not included.

```sh
claude plugin marketplace add /absolute/path/to/this-directory
claude plugin install jstack@jstack
codex plugin marketplace add /absolute/path/to/this-directory
codex plugin add jstack@jstack
```

See [jstack](plugins/jstack/README.md), [host support](plugins/jstack/CAPABILITIES.md), and
[attribution and license conditions](plugins/jstack/NOTICE.md).
This local snapshot has not been published to a remote marketplace.
''')
        result = check(temporary, private_values)
        os.rename(temporary, output)
        return {**result, 'output': str(output)}
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check', type=Path)
    parser.add_argument('--private-values', type=Path)
    args = parser.parse_args()
    if bool(args.output) == bool(args.check):
        parser.error('choose exactly one of --output or --check')
    try:
        values = json.loads(args.private_values.read_text()) if args.private_values else []
        if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
            raise builder.BuildError('private comparison must be a list of strings')
        result = check(args.check, values) if args.check else create(args.source, args.output, values)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
