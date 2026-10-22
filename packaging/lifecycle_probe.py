#!/usr/bin/env python3
"""Exercise real installers and preserve synthetic user assets through lifecycle.

All homes, profiles, projects, and marketplaces belong to a new disposable output.
No authentication material is copied and no source checkout is installed globally.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


host_tools = load('jstack_host_tools', 'host_probe.py')
builder = load('jstack_lifecycle_builder', 'build.py')
write = host_tools.write


def skill_rows(messages):
    result = next(m['result'] for m in messages if m.get('id') == 2)
    rows = []
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('name'), str) and isinstance(value.get('path'), str):
                rows.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(result)
    return rows


def snapshot(paths):
    result = {}
    for root in paths:
        items = [root, *root.rglob('*')] if root.is_dir() and not root.is_symlink() else [root]
        for item in items:
            if item.is_symlink():
                result[str(item)] = {'link': os.readlink(item), 'mode': item.lstat().st_mode & 0o777}
            elif item.is_file():
                result[str(item)] = {'sha256': hashlib.sha256(item.read_bytes()).hexdigest(),
                                     'mode': item.stat().st_mode & 0o777}
    return result


def run_host(host, previous, package, root):
    folder = root / host
    folder.mkdir()
    env = host_tools.environment(folder / 'home')
    home = Path(env['HOME'])
    project = folder / 'project'
    project.mkdir()
    records = []
    def run(argv, *, require=True, cwd=project, timeout=50):
        result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        records.append({'argv': argv, 'rc': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
        write(folder / 'commands.json', records)
        if require and result.returncode:
            raise RuntimeError('native command failed: ' + ' '.join(argv[:3]))
        return result
    version = run([host, '--version']).stdout.strip()
    market = folder / 'market'
    market.mkdir()
    marketplace = 'jstack-lifecycle'
    old_receipt = json.loads((previous / 'package-receipt.json').read_text())
    new_receipt = json.loads((package / 'package-receipt.json').read_text())
    if old_receipt['version'] == new_receipt['version']:
        raise RuntimeError('lifecycle needs distinct package versions')
    shutil.copytree(previous, market / 'plugins/jstack')
    unrelated = market / 'plugins/unrelated'
    for namespace in ['.claude-plugin', '.codex-plugin']:
        write(unrelated / namespace / 'plugin.json', {'name': 'unrelated', 'version': '0.0.1',
              'description': 'Independent preservation fixture', 'skills': './skills'} if namespace == '.codex-plugin'
              else {'name': 'unrelated', 'version': '0.0.1', 'description': 'Independent preservation fixture'})
    path = unrelated / 'skills/unrelated-fixture/SKILL.md'
    path.parent.mkdir(parents=True)
    path.write_text('---\nname: unrelated-fixture\ndescription: Independent fixture request only.\n---\nReturn the unrelated fixture marker.\n')
    write(market / '.claude-plugin/marketplace.json', {'name': marketplace, 'owner': {'name': 'jstack'},
          'plugins': [{'name': name, 'source': './plugins/' + name} for name in ['jstack', 'unrelated']]})
    write(market / '.agents/plugins/marketplace.json', {'name': marketplace, 'interface': {'displayName': 'jstack lifecycle'},
          'plugins': [{'name': name, 'source': {'source': 'local', 'path': './plugins/' + name},
                       'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'},
                       'category': 'Productivity'} for name in ['jstack', 'unrelated']]})
    # Seed user-owned data through the installed runtime's public CLI shape.
    runtime = package / 'payload/runtime'
    run(['git', 'init', '-q'])
    for relative in ['AGENTS.md', 'CLAUDE.md']:
        (project / relative).write_text('Existing project instruction fixture. Preserve this text.\n')
    (home / '.claude/CLAUDE.md').write_text('Existing global instruction fixture. Preserve this text.\n')
    for scope in ['project', 'global']:
        name = 'fixture-' + scope
        src = folder / ('source-' + scope)
        src.mkdir()
        (src / 'SKILL.md').write_text(f'---\nname: {name}\ndescription: Run only for the explicit {name} request.\n---\nReturn {name}-marker.\n')
        run(['python3', str(runtime / 'skill_store.py'), 'place', '--scope', scope, '--name', name,
             '--project', str(project), '--source', str(src)])
    config = home / '.config/gws-fixture'
    config.mkdir(parents=True)
    workspace = folder / 'workspace.json'
    reporting = folder / 'reporting.json'
    write(workspace, {'schemaVersion': 1, 'configDir': str(config), 'account': 'fixture-account'})
    write(reporting, {'schemaVersion': 1, 'subjectName': 'Example User', 'mailTo': 'recipient@example.invalid'})
    workspace.chmod(0o600)
    reporting.chmod(0o600)
    run(['python3', str(runtime / 'profiles.py'), 'save', 'work', '--workspace', str(workspace),
         '--reporting', str(reporting), '--expected-revision', '0', '--default'])
    profile = json.loads(run(['python3', str(runtime / 'profiles.py'), 'load']).stdout)
    protected = [home / '.jstack', home / '.agents/skills', home / '.claude/skills',
                 home / '.claude/CLAUDE.md', project / 'AGENTS.md', project / 'CLAUDE.md',
                 project / '.agents/skills', project / '.claude/skills', project / '.git/info/exclude',
                 project / '.git/jstack-skill-store.json']
    preserved = snapshot(protected)
    run([host, 'plugin', 'marketplace', 'add', str(market)])
    add = 'install' if host == 'claude' else 'add'
    remove = 'uninstall' if host == 'claude' else 'remove'
    run([host, 'plugin', add, 'unrelated@' + marketplace])
    def listing():
        data = json.loads(run([host, 'plugin', 'list', '--json']).stdout)
        return data if isinstance(data, list) else data['installed']
    def identity(row):
        return row.get('id', row.get('pluginId'))
    unrelated_before = next(row for row in listing() if identity(row) == 'unrelated@' + marketplace)
    unrelated_files = snapshot([home / f'.{host}/plugins/cache' / marketplace / 'unrelated'])
    checkpoints = []
    def assert_user_assets(label):
        if snapshot(protected) != preserved:
            raise RuntimeError(label + ': user profile, skill, link, exclude, or instruction changed')
        rows = listing()
        other = next((r for r in rows if identity(r) == 'unrelated@' + marketplace), None)
        if not other or not other.get('enabled') or other.get('version') != unrelated_before['version']:
            raise RuntimeError(label + ': independent plugin was removed or changed')
        if snapshot([home / f'.{host}/plugins/cache' / marketplace / 'unrelated']) != unrelated_files:
            raise RuntimeError(label + ': independent plugin files changed')
        checkpoints.append({'stage': label, 'userAssetsPreserved': True, 'unrelatedPluginPreserved': True})
    def installed(receipt):
        row = next((r for r in listing() if identity(r) == 'jstack@' + marketplace), None)
        if not row or not row.get('enabled') or row.get('version') != receipt['version']:
            raise RuntimeError('active plugin version/enabled state differs')
        base = Path(row['installPath']) if host == 'claude' else home / '.codex/plugins/cache' / marketplace / 'jstack' / receipt['version']
        base = base.resolve()
        for item in receipt['files']:
            path = base / item['path']
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
                raise RuntimeError('active installed bytes differ: ' + item['path'])
        loaded = json.loads(run(['python3', str(base / 'payload/runtime/profiles.py'), 'load']).stdout)
        if loaded != profile:
            raise RuntimeError('installed runtime loaded a different profile')
        if host == 'codex':
            messages = host_tools.codex_skills(project, env)
            write(folder / ('discovery-' + receipt['version'] + '.json'), messages)
            rows = skill_rows(messages)
            own = [r for r in rows if r['name'].startswith('jstack:')]
            if sorted(r['name'] for r in own) != ['jstack:' + n for n in receipt['publicSkills']]:
                raise RuntimeError('updated Codex public skill population differs')
            if any(not Path(r['path']).resolve().is_relative_to(base) for r in own):
                raise RuntimeError('Codex discovery still points to an old cache')
            for name in ['fixture-project', 'fixture-global']:
                if len([r for r in rows if r['name'] == name]) != 1:
                    raise RuntimeError('user skill is missing or duplicated: ' + name)
        else:
            detail = run([host, 'plugin', 'details', 'jstack@' + marketplace]).stdout
            if receipt['version'] not in detail.splitlines()[0]:
                raise RuntimeError('Claude detail uses a different version')
        return base
    run([host, 'plugin', add, 'jstack@' + marketplace])
    old_cache = installed(old_receipt)
    assert_user_assets('install')
    shutil.rmtree(market / 'plugins/jstack')
    shutil.copytree(package, market / 'plugins/jstack')
    run([host, 'plugin', 'update' if host == 'claude' else 'add', 'jstack@' + marketplace])
    active = installed(new_receipt)
    removed = {r['path'] for r in old_receipt['files']} - {r['path'] for r in new_receipt['files']}
    if not removed:
        raise RuntimeError('previous control package has no obsolete asset to test')
    if any((active / path).exists() for path in removed):
        raise RuntimeError('obsolete asset leaked into the active updated package')
    assert_user_assets('update')
    # Execute with the marketplace source hidden, using the active cache only.
    original, hidden = market / 'plugins/jstack', folder / 'hidden-source'
    original.rename(hidden)
    try:
        loaded = json.loads(run(['python3', str(active / 'payload/runtime/profiles.py'), 'load']).stdout)
        if loaded != profile:
            raise RuntimeError('source-independent profile load differs')
    finally:
        hidden.rename(original)
    run([host, 'plugin', remove, 'jstack@' + marketplace])
    if any(identity(r) == 'jstack@' + marketplace for r in listing()):
        raise RuntimeError('removed plugin remains installed')
    if host == 'codex' and any(r['name'].startswith('jstack:') for r in skill_rows(host_tools.codex_skills(project, env))):
        raise RuntimeError('removed Codex plugin remains discoverable')
    assert_user_assets('remove')
    run([host, 'plugin', add, 'jstack@' + marketplace])
    installed(new_receipt)
    if host == 'claude':
        startup = run([host, '--print', '--output-format', 'stream-json', '--verbose',
                       '--no-session-persistence', '--max-turns', '1', '--permission-mode', 'plan',
                       'Return the discovery fixture marker without tools.'], require=False, timeout=60)
        events = []
        for line in startup.stdout.splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
        init = next((e for e in events if e.get('type') == 'system' and e.get('subtype') == 'init'), None)
        if not init:
            raise RuntimeError('Claude startup did not expose native skill discovery')
        names = init.get('skills', [])
        for name in ['fixture-project', 'fixture-global']:
            if names.count(name) != 1:
                raise RuntimeError('Claude user skill missing or duplicated: ' + name)
        if sorted(n for n in names if n.startswith('jstack:')) != ['jstack:' + n for n in new_receipt['publicSkills']]:
            raise RuntimeError('Claude startup plugin skill population differs')
        write(folder / 'native-startup.json', events)
    assert_user_assets('reinstall')
    return {'host': host, 'version': version, 'passed': True, 'checkpoints': checkpoints,
            'profileReadFromInstalledRuntime': True, 'sourceIndependentRead': True,
            'obsoleteActiveFilesAbsent': sorted(removed), 'oldCacheRetained': old_cache.exists(),
            'userSkillsNativeDiscovery': True, 'modelInferenceTested': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous', type=Path, required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    for path in [args.previous, args.package]:
        builder.check(path)
    root = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='jstack-lifecycle-')).resolve()
    if args.output:
        root.mkdir(parents=True, exist_ok=False)
    print('Lifecycle evidence:', root, flush=True)
    results = []
    for host in ['claude', 'codex']:
        try:
            row = run_host(host, args.previous.resolve(), args.package.resolve(), root)
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as exc:
            row = {'host': host, 'passed': False, 'error': str(exc)}
        results.append(row)
        write(root / 'summary.json', {'previous': json.loads((args.previous / 'package-receipt.json').read_text())['sourceSha256'],
              'package': json.loads((args.package / 'package-receipt.json').read_text())['sourceSha256'], 'hosts': results})
        print(json.dumps(row, ensure_ascii=False), flush=True)
    return 0 if all(row['passed'] for row in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
