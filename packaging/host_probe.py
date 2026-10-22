#!/usr/bin/env python3
"""Probe actual installed Claude/Codex discovery in fresh disposable homes.

No API credentials are copied. This checks installation, discovery and direct
runtime execution; it does not claim model-inference or remote publishing success.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import stat
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def environment(home):
    home.mkdir(parents=True)
    (home / '.codex').mkdir()
    (home / '.claude').mkdir()
    env = os.environ.copy()
    env.update(HOME=str(home), CODEX_HOME=str(home / '.codex'), CLAUDE_CONFIG_DIR=str(home / '.claude'),
               XDG_CONFIG_HOME=str(home / '.config'), XDG_CACHE_HOME=str(home / '.cache'),
               XDG_STATE_HOME=str(home / '.state'), PYTHONDONTWRITEBYTECODE='1')
    for key in list(env):
        if any(token in key for token in ['API_KEY', 'AUTH_TOKEN', 'OAUTH_TOKEN']) or key == 'CLAUDECODE':
            del env[key]
    return env


def codex_skills(cwd, env):
    messages = []
    with tempfile.TemporaryFile(mode='w+') as errors:
        process = subprocess.Popen(['codex', 'app-server'], cwd=cwd, env=env, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=errors, text=False, bufsize=0)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        def send(data):
            process.stdin.write((json.dumps(data) + '\n').encode())
            process.stdin.flush()
        try:
            send({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'jstack-host-probe', 'version': '1.0.0'}, 'capabilities': {'experimentalApi': True}}})
            deadline, buffer = time.monotonic() + 45, b''
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('app-server terminated before skills/list')
                if not selector.select(timeout=0.5):
                    continue
                data = os.read(process.stdout.fileno(), 65536)
                if not data:
                    raise RuntimeError('app-server stdout closed')
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    if not line:
                        continue
                    message = json.loads(line)
                    messages.append(message)
                    if message.get('id') == 1:
                        if 'error' in message:
                            raise RuntimeError('app-server initialization failed')
                        send({'method': 'initialized'})
                        send({'id': 2, 'method': 'skills/list', 'params': {'cwds': [str(cwd)], 'forceReload': True}})
                    if message.get('id') == 2:
                        if 'error' in message:
                            raise RuntimeError('skills/list failed')
                        return messages
            raise RuntimeError('skills/list response timed out')
        finally:
            selector.close()
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def probe(package, root, hosts, private_values=()):
    package = package.resolve()
    receipt = json.loads((package / 'package-receipt.json').read_text())
    names = receipt['publicSkills']
    market = root / 'market'
    (market / 'plugins').mkdir(parents=True)
    shutil.copytree(package, market / 'plugins/jstack')
    marketplace = 'jstack-repack-test'
    write(market / '.claude-plugin/marketplace.json', {
        'name': marketplace, 'owner': {'name': 'jstack'}, 'plugins': [{'name': 'jstack', 'source': './plugins/jstack'}]})
    write(market / '.agents/plugins/marketplace.json', {
        'name': marketplace, 'interface': {'displayName': 'jstack test'}, 'plugins': [{
            'name': 'jstack', 'source': {'source': 'local', 'path': './plugins/jstack'},
            'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'}, 'category': 'Productivity'}]})
    results = []
    for host in hosts:
        folder = root / host
        home = folder / 'home'
        env = environment(home)
        commands = []
        def run(args):
            result = subprocess.run(args, cwd=folder, env=env, capture_output=True, text=True, timeout=50)
            commands.append({'argv': args, 'rc': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
            write(folder / 'commands.json', commands)
            if result.returncode:
                raise RuntimeError(host + ' command failed: ' + ' '.join(args[:3]))
            return result.stdout
        row = {'host': host, 'version': run([host, '--version']).strip(), 'modelInferenceTested': False}
        try:
            run([host, 'plugin', 'marketplace', 'add', str(market)])
            run([host, 'plugin', 'install' if host == 'claude' else 'add', 'jstack@' + marketplace])
            run([host, 'plugin', 'list'])
            entries = sorted((home / f'.{host}/plugins/cache').rglob(f'entries/{host}/*/SKILL.md'))
            if len(entries) != len(names):
                raise RuntimeError('cached entry count differs from declared skills')
            roots = {entry.parents[3] for entry in entries}
            if len(roots) != 1:
                raise RuntimeError('multiple active cache roots')
            installed = next(iter(roots)).resolve()
            if sorted(entry.parent.name for entry in entries) != names:
                raise RuntimeError('cached public names differ')
            if host == 'claude':
                detail = run([host, 'plugin', 'details', 'jstack@' + marketplace])
                match = re.search(r'^\s*Skills \((\d+)\)\s+(.+)$', detail, re.M)
                expected = Counter(names + [p.stem for p in (package / 'hosts/claude/commands').glob('*.md')])
                actual = Counter(x.strip() for x in match[2].split(',')) if match else Counter()
                if not match or int(match[1]) != sum(expected.values()) or actual != expected:
                    raise RuntimeError('Claude discovered duplicate or missing skills/commands')
                row['nativeDiscoveryCount'] = int(match[1])
                agents = re.search(r'^\s*Agents \((\d+)\)\s+(.+)$', detail, re.M)
                expected_agents = sorted(p.stem for p in (package / 'agents').glob('*.md'))
                if (not agents or int(agents[1]) != len(expected_agents) or
                        sorted(x.strip() for x in agents[2].split(',')) != expected_agents):
                    raise RuntimeError('Claude native agent inventory differs')
                hooks = re.search(r'^\s*Hooks \((\d+)\)\s+(.+?)(?:\s{2,}\(|$)', detail, re.M)
                expected_hooks = sorted(json.loads((package / 'hooks/hooks.json').read_text())['hooks'])
                if (not hooks or int(hooks[1]) != len(expected_hooks) or
                        sorted(x.strip() for x in hooks[2].split(',')) != expected_hooks):
                    raise RuntimeError('Claude native hook event inventory differs')
                row['nativeAgents'] = len(expected_agents)
                row['nativeHookEvents'] = len(expected_hooks)
            else:
                messages = codex_skills(folder, env)
                write(folder / 'discovery.json', messages)
                response = next(m['result'] for m in messages if m.get('id') == 2)
                found = []
                def walk(value):
                    if isinstance(value, dict):
                        if isinstance(value.get('path'), str) and str(value.get('name', '')).startswith('jstack:'):
                            found.append(value)
                        for child in value.values():
                            walk(child)
                    elif isinstance(value, list):
                        for child in value:
                            walk(child)
                walk(response)
                if sorted(x.get('name') for x in found) != ['jstack:' + name for name in names]:
                    raise RuntimeError('Codex native skills/list differs from declared names')
                if any(not Path(x['path']).resolve().is_relative_to(installed) for x in found):
                    raise RuntimeError('Codex discovered a different installation')
                row['nativeDiscoveryCount'] = len(found)
            # Independent byte comparison against the published artifact, not
            # just the cache's own manifest/receipt.
            expected_files = {item['path']: item['sha256'] for item in receipt['files']}
            for relative, digest in expected_files.items():
                path = installed / relative
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise RuntimeError('installed asset differs: ' + relative)
            for item in receipt['files']:
                if stat.S_IMODE((installed / item['path']).stat().st_mode) != item['mode']:
                    raise RuntimeError('installed file mode differs: ' + item['path'])
            row['byteMatchedFiles'] = len(expected_files)
            spec = importlib.util.spec_from_file_location('jstack_installed_checker', Path(__file__).with_name('build.py'))
            checker = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(checker)
            row['installedPackageCheck'] = checker.check(installed, private_values)
            # Remove the marketplace source from the expected location before
            # executing installed scripts. The original caller may be elsewhere;
            # these scripts are also inspected for source-path references.
            original, hidden = market / 'plugins/jstack', root / 'source-hidden'
            original.rename(hidden)
            try:
                markers = []
                for entry in entries:
                    output = run(['python3', str(entry.parent / 'scripts/inspect-root.py')])
                    marker = json.loads(output)
                    if not marker.get('runtimePresent') or not marker.get('sourcePresent'):
                        raise RuntimeError('installed dependency is missing')
                    if Path(marker['root']) != installed or not Path(marker['canonical']).is_relative_to(installed):
                        raise RuntimeError('entry resolves outside installed cache')
                    markers.append(marker)
                runtime = installed / ('payload/runtime' if (installed / 'payload').exists() else 'runtime')
                inspected = json.loads(run(['python3', str(runtime / 'profiles.py'), 'inspect']))
                if inspected != {'configured': False, 'profiles': []} or (home / '.jstack').exists():
                    raise RuntimeError('read-only inspection wrote user state')
                row['executedEntries'] = len(markers)
                write(folder / 'execution.json', markers)
            finally:
                hidden.rename(original)
            row['passed'] = True
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
            row.update(passed=False, error=str(exc))
        results.append(row)
        write(root / 'summary.json', {'packageSourceSha256': receipt['sourceSha256'], 'hosts': results})
        print(json.dumps(row, ensure_ascii=False), flush=True)
    return all(row.get('passed') for row in results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--host', choices=['claude', 'codex', 'both'], default='both')
    parser.add_argument('--private-values', type=Path)
    args = parser.parse_args()
    if args.output:
        root = args.output.absolute()
        root.mkdir(parents=True, exist_ok=False)
    else:
        root = Path(tempfile.mkdtemp(prefix='jstack-host-probe-')).resolve()
    hosts = ['claude', 'codex'] if args.host == 'both' else [args.host]
    print('Evidence:', root, flush=True)
    values = json.loads(args.private_values.read_text()) if args.private_values else []
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        parser.error('private comparison must be a list of strings')
    return 0 if probe(args.package, root, hosts, values) else 1


if __name__ == '__main__':
    raise SystemExit(main())
