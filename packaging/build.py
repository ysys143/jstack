#!/usr/bin/env python3
"""Build and check one portable jstack package for Claude Code and Codex.

Explicit source-to-target membership is versioned in package-files.json.
The builder neither installs plugins nor modifies a marketplace or user home.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

sys.dont_write_bytecode = True
LOCAL = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('jstack_public_check', LOCAL / 'check_public.py')
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)

SKIP_DIRS = public.PRIVATE_DIRS | {'results', '.mypy_cache', 'target'}
SKIP_NAMES = {'.DS_Store', '.suite-body-deleted'}
COMPONENTS = {'cli', 'skills', 'runtime', 'scripts', 'tests', 'evals', 'contracts', 'packaging'}
TOP_ASSETS = {'README.md', 'CAPABILITIES.md', 'CHANGELOG.md', 'NOTICE.md'}
HOST_KINDS = {'commands', 'agents', 'hooks', 'output-styles'}
RECEIPT = 'package-receipt.json'
GENERATED_MANIFESTS = {'.claude-plugin/plugin.json', '.codex-plugin/plugin.json'}


class BuildError(ValueError):
    pass


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def safe_relative(raw):
    path = Path(raw)
    if path.is_absolute() or not raw or any(p in {'..', '.'} for p in raw.split('/')) or '\\' in raw:
        raise BuildError('manifest paths must be safe relative POSIX paths')
    return path


def walk_files(root, directory, active=(), excluded=()):
    real = directory.resolve()
    if not real.is_relative_to(root) or real in active:
        raise BuildError('external or cyclic source link')
    for path in sorted(directory.iterdir()):
        if path.relative_to(root).as_posix() in excluded:
            continue
        if path.name in SKIP_DIRS | SKIP_NAMES or path.suffix in {'.pyc', '.pyo'}:
            continue
        if path.is_symlink():
            if Path(os.readlink(path)).is_absolute() or not path.exists() or not path.resolve().is_relative_to(root):
                raise BuildError('absolute, broken or external source link')
        if path.is_dir():
            yield from walk_files(root, path, active + (real,), excluded)
        elif path.is_file():
            yield path
        else:
            raise BuildError('unsupported source file type')


def discover_membership(source):
    """Produce a reviewable manifest; build never refreshes this automatically."""
    source = source.resolve()
    exclusions_path = source / 'packaging/excluded-aliases.json'
    exclusions = json.loads(exclusions_path.read_text()) if exclusions_path.is_file() else []
    excluded = set()
    for row in exclusions:
        alias = source / safe_relative(row['source'])
        canonical = source / safe_relative(row['canonical'])
        if (not row.get('reason') or not alias.is_symlink() or
                Path(os.readlink(alias)).is_absolute() or not canonical.is_dir() or
                alias.resolve() != canonical.resolve() or not canonical.resolve().is_relative_to(source)):
            raise BuildError('excluded alias no longer matches its canonical directory')
        excluded.add(row['source'])
    members = []
    for component in sorted(COMPONENTS):
        directory = source / component
        if not directory.is_dir():
            continue
        for path in walk_files(source, directory, excluded=excluded):
            rel = path.relative_to(source).as_posix()
            if rel == 'packaging/package-files.json':
                continue  # membership is configuration, not a product input
            members.append({'source': rel, 'target': rel})
    for kind in sorted(HOST_KINDS):
        directory = source / 'hosts/claude' / kind
        if directory.is_dir():
            for path in walk_files(source, directory):
                members.append({'source': path.relative_to(source).as_posix(),
                                'target': kind + '/' + path.relative_to(directory).as_posix()})
    native = source / 'hosts/codex/skills'
    if native.is_dir():
        for path in sorted(native.glob('*/SKILL.md')):
            members.append({'source': path.relative_to(source).as_posix(),
                            'target': 'skills/' + path.parent.name + '/SKILL.codex.md'})
    guide = source / 'packaging/AGENTS.package.md'
    if guide.is_file():
        members.append({'source': 'packaging/AGENTS.package.md', 'target': 'AGENTS.md'})
    for name in sorted(TOP_ASSETS):
        if (source / name).is_file():
            members.append({'source': name, 'target': name})
    for name, target in [('package.json', 'packaging/source-package.json'),
                         ('package-lock.json', 'packaging/source-package-lock.json'),
                         ('tsconfig.json', 'packaging/source-tsconfig.json')]:
        if (source / name).is_file():
            members.append({'source': name, 'target': target})
    return {'schemaVersion': 1, 'files': sorted(members, key=lambda item: item['target'])}


def source_manifest(source):
    path = source / 'packaging/package-files.json'
    raw = json.loads(path.read_text())
    if raw.get('schemaVersion') != 1 or not isinstance(raw.get('files'), list) or not raw['files']:
        raise BuildError('missing or empty package membership')
    actual = discover_membership(source)
    if raw != actual:
        declared = {(x.get('source'), x.get('target')) for x in raw['files']}
        found = {(x['source'], x['target']) for x in actual['files']}
        raise BuildError('membership drift; review inventory changes: ' + json.dumps(
            {'undeclared': sorted(found - declared), 'missing': sorted(declared - found)}, ensure_ascii=False))
    destinations = []
    for row in raw['files']:
        source_path = source / safe_relative(row['source'])
        target = safe_relative(row['target']).as_posix()
        if not source_path.resolve().is_relative_to(source) or not source_path.is_file():
            raise BuildError('missing or escaping member')
        if target in GENERATED_MANIFESTS or target.startswith('entries/') or target == RECEIPT:
            raise BuildError('source member shadows generated output')
        destinations.append(target)
    if len(destinations) != len(set(destinations)):
        raise BuildError('duplicate package target')
    return raw


def public_skills(source):
    skills = sorted(p.parent.name for p in (source / 'skills').glob('*/SKILL.md') if not p.parent.name.startswith('_'))
    if not skills:
        raise BuildError('no public skills')
    return skills


def selected_entry(source, name, host):
    if host == 'codex':
        for path in [source / 'hosts/codex/skills' / name / 'SKILL.md',
                     source / 'skills' / name / 'SKILL.codex.md']:
            if path.is_file():
                return path
    return source / 'skills' / name / 'SKILL.md'


def entry_body(text, name, host):
    match = re.match(r'\A---\n.*?\n---\n', text, re.S)
    if not match:
        raise BuildError('public entry requires YAML frontmatter')
    if not re.search(r'^name:\s*' + re.escape(name) + r'\s*$', match[0], re.M):
        raise BuildError('public name differs from skill directory')
    # This is a root-variable migration, not a translation of tool semantics.
    # New canonical sources use JSTACK_PLUGIN_ROOT; old transition sources are
    # rejected after the root migration rather than silently rewritten here.
    if '${CLAUDE_PLUGIN_ROOT}' in text:
        raise BuildError('shared/native source still uses Claude-only root notation: ' + name)
    root_note = f'''
## Installed root and host boundary

This is the generated {host} entry for `{name}`. Resolve this installed
SKILL.md directory's `../../..` as the package root. In each shell invocation,
set `JSTACK_PLUGIN_ROOT` to that root's `payload/` directory with shell quoting; shell
variables do not persist across tool calls. For skill-local `scripts/`,
`references/`, `assets/`, or other relative paths in the source below, use
`<package-root>/payload/skills/{name}/` as the working/base directory. These files are
inside this same installed package. Never use the publisher's source path.
`python3 scripts/inspect-root.py` from this entry prints the resolved installed
paths without changing the user's environment.

'''
    if host == 'codex':
        root_note += '''Claude slash-command registration, agent types, and automatic hooks are not
registered in Codex by these manifests. Use native tools and explicit gates;
report unsupported automatic enforcement. Host support is described in
`<package-root>/CAPABILITIES.md`. A description of a Claude hook in a retained
reference does not install that hook here.

'''
    else:
        root_note += '''Claude's commands and hooks use its native plugin root. Shared runtime commands
use JSTACK_PLUGIN_ROOT resolved above. Optional configuration and integrations are
not enabled merely by installing this package.

'''
    return text[:match.end()] + root_note + text[match.end():]


def digest_files(root):
    rows = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise BuildError('package contains a symlink')
        if path.is_file() and path.relative_to(root).as_posix() != RECEIPT:
            rows.append({'path': path.relative_to(root).as_posix(),
                         'mode': stat.S_IMODE(path.stat().st_mode),
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return rows


def manifests(product):
    if product.get('name') != 'jstack' or not product.get('version') or not product.get('description'):
        raise BuildError('invalid product identity')
    common = {key: product[key] for key in ['name', 'version', 'description', 'author']}
    claude = {**common, 'skills': ['./entries/claude'], 'commands': ['./hosts/claude/commands'],
              'experimental': {'evals': 'payload/evals'}}
    codex = {**common, 'skills': './entries/codex', 'interface': {
        'displayName': 'jstack', 'shortDescription': product['description'][:100],
        'longDescription': product['description'], 'developerName': product['author']['name'],
        'category': 'Productivity', 'capabilities': ['Read', 'Write'],
        'defaultPrompt': ['Perform the current task according to the jstack procedure.']}}
    return {'claude': claude, 'codex': codex}


def build(source, output, private_values=()):
    source, output = source.resolve(), output.absolute()
    if output.exists() or output.is_symlink():
        raise BuildError('output must not exist')
    if output.resolve().is_relative_to(source):
        raise BuildError('output must be outside the source root')
    if not (source / 'packaging/check_public.py').is_file():
        raise BuildError('publication checker missing')
    membership = source_manifest(source)
    product = json.loads((source / 'packaging/product.json').read_text())
    skills = public_skills(source)
    generated = manifests(product)
    selected = {(host, name): selected_entry(source, name, host) for host in ['claude', 'codex'] for name in skills}
    before = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in
              {source / row['source'] for row in membership['files']} | set(selected.values()) |
              {source / 'packaging/package-files.json'}}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.jstack-build-', dir=output.parent))
    try:
        package = temporary / 'jstack'
        package.mkdir()
        (package / 'hosts/claude/commands').mkdir(parents=True)
        for row in membership['files']:
            destination = package / 'payload' / row['target']
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / row['source'], destination, follow_symlinks=True)
        write_json(package / 'payload/packaging/package-files.json', membership)
        # The complete runtime retains its original relative layout outside the
        # hosts' implicit skills/ directory. Claude custom skills directories
        # are additive, so a top-level canonical skills/ tree would duplicate it.
        write_json(package / 'payload/.claude-plugin/plugin.json',
                   {**product, 'experimental': {'evals': 'evals'}})
        for row in membership['files']:
            relative = Path(row['target'])
            expose = (relative.parts[0] in {'commands', 'agents', 'output-styles'} or
                      relative.as_posix() == 'hooks/hooks.json' or
                      relative.as_posix() in TOP_ASSETS | {'AGENTS.md'})
            if not expose:
                continue
            original = package / 'payload' / relative
            destination = package / ('hosts/claude' if relative.parts[0] == 'commands' else '') / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if relative.parts[0] in {'commands', 'agents', 'hooks'}:
                # Only the native Claude registration layer uses this expansion.
                # Shared source prose is already host-neutral and is not rewritten.
                destination.write_text(original.read_text().replace(
                    '${CLAUDE_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}/payload'))
                shutil.copymode(original, destination)
            else:
                shutil.copy2(original, destination)
        for host, manifest in generated.items():
            write_json(package / f'.{host}-plugin/plugin.json', manifest)
            for name in skills:
                entry = package / 'entries' / host / name
                entry.mkdir(parents=True)
                (entry / 'SKILL.md').write_text(entry_body(selected[host, name].read_text(), name, host))
                (entry / 'scripts').mkdir()
                (entry / 'scripts/inspect-root.py').write_text(
                    'from pathlib import Path\nimport json\n'
                    'root = Path(__file__).resolve().parents[4]\n'
                    f'skill = root / "payload/skills/{name}"\n'
                    f'print(json.dumps({{"host": "{host}", "skill": "{name}", '
                    '"root": str(root), "canonical": str(skill), '
                    '"runtimePresent": (root / "payload/runtime/profiles.py").is_file(), '
                    '"sourcePresent": (skill / "SKILL.md").is_file()}))\n')
        after = {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in before}
        if before != after:
            raise BuildError('source changed during build')
        privacy = public.inspect(package, private_values)
        if not privacy['passed']:
            raise BuildError('publication boundary failed: ' + json.dumps(privacy, ensure_ascii=False))
        rows = digest_files(package)
        receipt = {'schemaVersion': 1, 'name': 'jstack', 'version': product['version'],
                   'publicSkills': skills, 'files': rows,
                   'sourceSha256': hashlib.sha256(json.dumps(sorted(
                       (str(Path(k).relative_to(source)), v) for k, v in before.items())).encode()).hexdigest(),
                   'privacy': {'scannedFiles': privacy['scannedFiles'], 'passed': True,
                               'privateComparisonUsed': bool(private_values)}}
        write_json(package / RECEIPT, receipt)
        check(package, private_values)
        os.rename(package, output)
        return {'output': str(output), 'version': product['version'], 'publicSkills': len(skills),
                'files': len(rows), 'sourceSha256': receipt['sourceSha256']}
    finally:
        shutil.rmtree(temporary)


def check(package, private_values=()):
    package = package.resolve()
    if not (package / 'payload/packaging/check_public.py').is_file():
        raise BuildError('publication checker missing')
    receipt = json.loads((package / RECEIPT).read_text())
    if receipt.get('schemaVersion') != 1 or not receipt.get('files') or not receipt.get('publicSkills'):
        raise BuildError('invalid or empty package receipt')
    actual = digest_files(package)
    membership = json.loads((package / 'payload/packaging/package-files.json').read_text())
    if membership.get('schemaVersion') != 1 or not membership.get('files'):
        raise BuildError('package membership is missing')
    declared = {'payload/' + safe_relative(row['target']).as_posix() for row in membership['files']}
    declared |= GENERATED_MANIFESTS | {'payload/packaging/package-files.json', 'payload/.claude-plugin/plugin.json'}
    for row in membership['files']:
        relative = safe_relative(row['target'])
        if (relative.parts[0] in {'commands', 'agents', 'output-styles'} or
                relative.as_posix() == 'hooks/hooks.json' or relative.as_posix() in TOP_ASSETS | {'AGENTS.md'}):
            declared.add(('hosts/claude/' if relative.parts[0] == 'commands' else '') + relative.as_posix())
    for host in ['claude', 'codex']:
        for name in receipt['publicSkills']:
            if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name):
                raise BuildError('invalid public skill name')
            declared |= {f'entries/{host}/{name}/SKILL.md', f'entries/{host}/{name}/scripts/inspect-root.py'}
    if declared != {row['path'] for row in actual}:
        raise BuildError('package membership differs from the declared publication surface')
    if receipt['files'] != actual:
        raise BuildError('package files, modes or contents differ from the receipt')
    product = json.loads((package / 'payload/packaging/product.json').read_text())
    expected = manifests(product)
    if not (package / 'hosts/claude/commands').is_dir() or (package / 'skills').exists() or (package / 'commands').exists():
        raise BuildError('implicit host discovery surface is unsafe or incomplete')
    for host in ['claude', 'codex']:
        observed = json.loads((package / f'.{host}-plugin/plugin.json').read_text())
        if observed != expected[host]:
            raise BuildError('host manifest does not match product metadata')
        names = sorted(p.parent.name for p in (package / 'entries' / host).rglob('SKILL.md'))
        if names != receipt['publicSkills']:
            raise BuildError('unexpected public skill discovery surface')
        for name in names:
            if not (package / 'payload/skills' / name / 'SKILL.md').is_file():
                raise BuildError('missing canonical skill dependency')
    privacy = public.inspect(package, private_values)
    if not privacy['passed']:
        raise BuildError('publication boundary failed: ' + json.dumps(privacy, ensure_ascii=False))
    return {'passed': True, 'version': product['version'], 'publicSkills': len(receipt['publicSkills']),
            'files': len(actual), 'privacy': privacy}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    inventory = commands.add_parser('inventory')
    inventory.add_argument('--source', type=Path, required=True)
    inventory.add_argument('--output', type=Path, required=True)
    build_parser = commands.add_parser('build')
    build_parser.add_argument('--source', type=Path, required=True)
    build_parser.add_argument('--output', type=Path, required=True)
    build_parser.add_argument('--private-values', type=Path)
    check_parser = commands.add_parser('check')
    check_parser.add_argument('package', type=Path)
    check_parser.add_argument('--private-values', type=Path)
    args = parser.parse_args()
    try:
        values = json.loads(args.private_values.read_text()) if getattr(args, 'private_values', None) else []
        if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
            raise BuildError('private comparison list must contain strings')
        if args.command == 'inventory':
            result = discover_membership(args.source)
            write_json(args.output, result)
            result = {'inventory': str(args.output), 'files': len(result['files']), 'reviewRequired': True}
        elif args.command == 'build':
            result = build(args.source, args.output, values)
        else:
            result = check(args.package, values)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (BuildError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
