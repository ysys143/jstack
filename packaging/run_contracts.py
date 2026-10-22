#!/usr/bin/env python3
"""Run contributor contracts against a built, committed, disposable runtime.

The user's index, installed plugins, and home configuration are never modified.
Current contract checkers are shipped alongside the runtime they validate.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('skills', nargs='*')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    wanted = {}
    if not args.skills or 'diagram' in args.skills:
        wanted.update({'fonttools': '4.53.1', 'brotli': '1.1.0'})
    if not args.skills or 'verify' in args.skills or any(name.startswith('tests/') for name in args.skills):
        wanted['PyYAML'] = '6.0.3'
    installed = {}
    for name in wanted:
        try:
            installed[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            installed[name] = None
    if installed != wanted:
        print('Contract dependencies unavailable or differ from validated pins:', installed, file=sys.stderr)
        print("Run: uv run --isolated --no-project --python 3.12 --with 'fonttools==4.53.1' --with 'brotli==1.1.0' --with 'PyYAML==6.0.3' python packaging/run_contracts.py [skills]", file=sys.stderr)
        return 2
    source = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('jstack_contract_builder', source / 'packaging/build.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    if args.output:
        root = args.output.resolve()
        root.mkdir(parents=True, exist_ok=False)
    else:
        root = Path(tempfile.mkdtemp(prefix='jstack-contracts-')).resolve()
    print('Contract evidence:', root, flush=True)
    package = root / 'package'
    built = builder.build(source, package)
    runtime = root / 'jstack'
    shutil.copytree(package / 'payload', runtime)
    env = dict(os.environ, JSTACK_RUNTIME_ROOT=str(runtime),
               JSTACK_SUITE_EVIDENCE_DIR=str(root / 'suites'), JSTACK_PACKAGE_ROOT=str(package), PYTHONDONTWRITEBYTECODE='1')
    index_path = subprocess.check_output(['git', 'rev-parse', '--git-path', 'index'], cwd=source, text=True).strip()
    index = (source / index_path).resolve()
    index_before = hashlib.sha256(index.read_bytes()).hexdigest() if index.is_file() else None
    for command in [['git', 'init', '-q'], ['git', 'add', '.'],
                    ['git', '-c', 'user.name=jstack validation', '-c', 'user.email=validation@example.invalid',
                     'commit', '-qm', 'test: bind disposable runtime snapshot']]:
        subprocess.run(command, cwd=runtime, env=env, check=True)
    # Keep build dependencies outside the contracted runtime. The shell runner
    # exposes them only while dashboard's own tests run, then removes that link.
    # A permanent link violates identity checks; a permanent copy changes the
    # artifact surface seen by author. Neither belongs in the package under test.
    if not args.skills or 'dashboard' in args.skills:
        dependency_source = source / 'skills/dashboard/node_modules'
        if not dependency_source.is_dir():
            dependency_work = root / 'dashboard-build-environment'
            dependency_work.mkdir()
            for filename in ['package.json', 'package-lock.json']:
                shutil.copy2(runtime / 'skills/dashboard' / filename, dependency_work / filename)
            with (root / 'dashboard-dependencies.log').open('w') as log:
                subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'],
                               cwd=dependency_work, env=env,
                               stdout=log, stderr=subprocess.STDOUT, check=True)
            dependency_source = dependency_work / 'node_modules'
        env['JSTACK_DASHBOARD_DEPENDENCIES'] = str(dependency_source.resolve())
    with (root / 'run.log').open('w') as log:
        process = subprocess.Popen(['bash', 'scripts/run_suites.sh', *args.skills],
                                   cwd=runtime, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True)
        for line in process.stdout:
            print(line, end='', flush=True)
            log.write(line)
            log.flush()
        rc = process.wait()
    after = hashlib.sha256(index.read_bytes()).hexdigest() if index.is_file() else None
    preserved = after == index_before
    summary = {'schemaVersion': 1, 'package': built, 'skills': args.skills,
               'exitCode': rc, 'sourceIndexPreserved': preserved,
               'deletionSkipped': env.get('JSTACK_SKIP_DELETION') == '1',
               'pythonVersion': sys.version,
               'packages': {d.metadata['Name']: d.version for d in importlib.metadata.distributions()},
               'runtimeGitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=runtime, text=True).strip()}
    (root / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    return rc if preserved else 2


if __name__ == '__main__':
    raise SystemExit(main())
