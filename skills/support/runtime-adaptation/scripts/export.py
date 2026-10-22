#!/usr/bin/env python3
"""Build a portable native Codex plugin from one canonical plugin directory.

No marketplace registration or user-home changes. The output must not exist.
Host semantics use reviewed native entries; only plugin-root notation changes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

import install as bridge


EXCLUDED = bridge.IGNORED_DIRS | {'.pytest_cache', '.mypy_cache', '.omc', '.jstack'}
PREAMBLE = """
## Codex installed paths and capabilities

Resolve the outer package root from the installed path of this SKILL.md: its
skill directory is two levels below that root. The complete runtime tree is at
`<outer-root>/payload`; before a shell command using
`${JSTACK_PLUGIN_ROOT}`, set that variable to the resolved absolute root in the
same shell invocation, with shell quoting. Set it to the outer root's
`payload` directory. Do not use the build machine's path or assume a previous
shell variable persists. Runtime references and scripts are under
`JSTACK_PLUGIN_ROOT`, so they remain relative to the copied payload.

This native package exposes skills. Descriptions of Claude command registration,
agent templates, or automatic tool hooks in retained references do not install
those capabilities in Codex. Use actual native tools and explicit local gates;
report missing enforcement when the task requires it. See host-adapter.json at
the plugin root for the delivery boundary and source identity.

"""
README_NOTE = """<!-- Codex delivery note: this package exposes skills/ as its public entrypoint. -->
The original execution and reference paths below resolve under `payload/` in
this native package. Claude slash-command registration is not provided.

"""


def ignored(directory, names):
    return {n for n in names if n in EXCLUDED or n.endswith(('.pyc', '.pyo'))
            or n in {'.DS_Store', '.suite-body-deleted'}}


def inventory(root, *, omit_receipt=False):
    """Hash framed relative paths, modes and content; refuse escaping symlinks."""
    root = Path(root).resolve()
    rows = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        omitted = ignored(directory, dirs + files)
        dirs[:] = sorted(n for n in dirs if n not in omitted)
        for name in sorted(set(dirs + files) - omitted):
            p = Path(directory, name)
            rel = p.relative_to(root).as_posix()
            if omit_receipt and rel == 'host-adapter.json':
                continue
            if p.is_symlink():
                if not p.resolve().is_relative_to(root) or not p.exists():
                    raise ValueError(f'unsafe symlink: {rel}')
                # Absolute links would become source dependencies after relocation.
                if Path(os.readlink(p)).is_absolute():
                    raise ValueError(f'absolute symlink: {rel}')
                data, kind = os.readlink(p).encode(), 'link'
            elif p.is_file():
                data, kind = p.read_bytes(), 'file'
            elif p.is_dir():
                continue
            else:
                raise ValueError(f'unsupported file type: {rel}')
            rows.append([rel, kind, p.lstat().st_mode & 0o777,
                         hashlib.sha256(data).hexdigest()])
    encoded = json.dumps(sorted(rows), ensure_ascii=False,
                         separators=(',', ':')).encode()
    return hashlib.sha256(encoded).hexdigest()


def native_manifest(source):
    data = {k: source[k] for k in ('name', 'version', 'description', 'author')}
    if not all(data.get(k) for k in ('name', 'version', 'description')):
        raise ValueError('source manifest has empty required values')
    data['skills'] = './skills/'
    data['interface'] = {
        'displayName': source['name'],
        'shortDescription': source['description'][:100],
        'longDescription': source['description'],
        'developerName': source['author']['name'],
        'category': 'Productivity',
        'capabilities': ['Read', 'Write'],
            'defaultPrompt': ["Follow this plugin's workflow to perform the current task."],
    }
    return data


def native_entry(text, skill_name):
    if not text.startswith('---\n') or '\n---\n' not in text[4:]:
        raise ValueError('skill entry requires YAML frontmatter')
    pos = text.index('\n---\n', 4) + len('\n---\n')
    relative_root = (
        f"Relative paths in this entry, including `scripts/` and `references/`, "
        f"resolve from `<outer-root>/payload/skills/{skill_name}/`.\n"
        "Use that entry directory for skill-local files; use `JSTACK_PLUGIN_ROOT` "
        "for plugin-level files.\n\n"
    )
    return text[:pos] + PREAMBLE + relative_root + text[pos:]


def export(source, output):
    source = Path(source).resolve()
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError(f'destination already exists: {output}')
    if output.resolve().is_relative_to(source):
        raise ValueError('destination must be outside the source plugin')
    manifest_path = source / '.claude-plugin/plugin.json'
    manifest = native_manifest(json.loads(manifest_path.read_text()))
    before = inventory(source)
    skills = []
    for skill in sorted((source / 'skills').iterdir()):
        if not (skill / 'SKILL.md').is_file():
            continue
        mode, blockers, _ = bridge.classify_tree(str(skill))
        has_native_override = (skill / 'SKILL.codex.md').is_file()
        for rel, body in bridge.runtime_texts(str(skill)):
            if has_native_override and rel in {'SKILL.md', 'SKILL.codex.md'}:
                continue
            if rel.endswith(('.md', '.mdx')) and re.search(r'\bTeam(?:Create|Delete)\b', body):
                blockers = list(blockers or []) + [{
                    'reason': f'{rel}: Claude team lifecycle requires a native entry'}]
        if blockers:
            reasons = '; '.join(b['reason'] for b in blockers)
            raise ValueError(f'{skill.name}: native entry required: {reasons}')
        skills.append((skill.name, mode))
    if not skills:
        raise ValueError('no skills to export')

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.jstack-export-', dir=output.parent))
    try:
        package = temporary / output.name
        package.mkdir()
        (package / 'skills').mkdir()
        for name, _ in skills:
            origin = source / 'skills' / name
            destination = package / 'skills' / name
            destination.mkdir(parents=True)
            entry = origin / 'SKILL.codex.md'
            if not entry.exists():
                entry = origin / 'SKILL.md'
            selected_body = entry.read_text()
            (destination / 'SKILL.md').write_text(native_entry(
                selected_body.replace('${CLAUDE_PLUGIN_ROOT}', '${JSTACK_PLUGIN_ROOT}'),
                name))
        # Keep the complete source runtime under payload. The outer skills
        # directory is intentionally flat so Codex cannot discover nested
        # upstream SKILL.md files as additional native entries.
        payload = package / 'payload'
        # Native Codex installation may omit symlink entries from its cache.
        # `inventory(source)` has already rejected absolute, escaping, and
        # broken links; materialize the remaining internal links so the
        # relocated payload retains their target files and directories.
        shutil.copytree(source, payload, symlinks=False, ignore=ignored)
        for name, _ in skills:
            origin, destination = source / 'skills' / name, payload / 'skills' / name
            entry = origin / 'SKILL.codex.md'
            if not entry.exists():
                entry = origin / 'SKILL.md'
            selected_body = entry.read_text()
            (destination / 'SKILL.md').write_text(
                selected_body.replace('${CLAUDE_PLUGIN_ROOT}', '${JSTACK_PLUGIN_ROOT}'))
            for rel, _ in bridge.runtime_texts(str(origin)):
                target = destination / rel
                if target.suffix.lower() not in {'.md', '.mdx'}:
                    continue
                target.write_text(target.read_text().replace(
                    '${CLAUDE_PLUGIN_ROOT}', '${JSTACK_PLUGIN_ROOT}'))
        for name, _ in skills:
            native_agents = source / 'skills' / name / 'agents' / 'openai.yaml'
            if native_agents.is_file():
                destination = package / 'skills' / name / 'agents'
                destination.mkdir(parents=True, exist_ok=True)
                shutil.copy2(native_agents, destination / 'openai.yaml')

        # No Claude manifest, commands, agents, or automatic hook registration
        # exists at the outer host-discovery boundary. Payload retains the
        # source manifest so scripts that inspect their own package still work.
        dest_manifest = package / '.codex-plugin/plugin.json'
        dest_manifest.parent.mkdir(exist_ok=True)
        dest_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for record in ('README.md', 'README.ko.md', 'CHANGELOG.md'):
            source_record = source / record
            if source_record.is_file():
                if record.startswith('README'):
                    (package / record).write_text(
                        README_NOTE + source_record.read_text())
                else:
                    shutil.copy2(source_record, package / record)
        if inventory(source) != before:
            raise ValueError('source changed during export; retry from stable input')
        receipt = {
            'schema': 1, 'host': 'codex', 'sourceTreeSha256': before,
            'name': manifest['name'], 'version': manifest['version'],
            'skills': [{'name': n, 'entry': 'native' if m == 'override' else 'common'}
                       for n, m in skills],
            'unavailableAutomaticSurfaces': ['Claude commands', 'Claude agents',
                                             'Claude tool hooks'],
            'rootResolution': 'outer SKILL.md directory / ../..; payload = ../../payload',
            'payloadRoot': 'payload',
        }
        # Receipt excludes itself, so it can be verified without a hash cycle.
        receipt['payloadTreeSha256'] = inventory(package)
        (package / 'host-adapter.json').write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        package.rename(output)
        return receipt
    finally:
        shutil.rmtree(temporary)


def check(package):
    package = Path(package).resolve()
    receipt = json.loads((package / 'host-adapter.json').read_text())
    if receipt.get('schema') != 1 or receipt.get('host') != 'codex':
        raise ValueError('unsupported delivery receipt')
    if inventory(package, omit_receipt=True) != receipt.get('payloadTreeSha256'):
        raise ValueError('exported payload changed; regenerate from source')
    manifest = json.loads((package / '.codex-plugin/plugin.json').read_text())
    if any(manifest.get(k) != receipt.get(k) for k in ('name', 'version')):
        raise ValueError('manifest and delivery receipt disagree')
    discovered = sorted(p.parent.name for p in (package / 'skills').glob('*/SKILL.md'))
    if discovered != sorted(s['name'] for s in receipt['skills']):
        raise ValueError('skill discovery and delivery receipt disagree')
    payload_manifest = package / 'payload/.claude-plugin/plugin.json'
    if not payload_manifest.is_file():
        raise ValueError('payload source manifest is missing')
    if (package / '.claude-plugin').exists() or any(
        (package / surface).exists() for surface in ('commands', 'agents', 'hooks')
    ):
        raise ValueError('Claude host surfaces leaked into outer package')
    return {'valid': True, 'name': manifest['name'], 'skills': discovered}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source')
    parser.add_argument('--output')
    parser.add_argument('--check', metavar='PACKAGE')
    args = parser.parse_args()
    try:
        if args.check:
            if args.source or args.output:
                parser.error('--check cannot be combined with --source/--output')
            result = check(args.check)
        else:
            if not args.source or not args.output:
                parser.error('--source and --output are required for export')
            result = export(args.source, args.output)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError) as exc:
        print(f'export blocked: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
