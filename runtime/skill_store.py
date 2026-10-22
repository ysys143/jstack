#!/usr/bin/env python3
"""Place user-authored skills once, connect hosts, and control Git sharing.

Explicit scope is required. Never stage, commit, change instruction files,
untrack files, or overwrite an existing skill. Copies are only new sources;
host discovery uses relative links to that source.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import socket
import time


@contextmanager
def portable_lock(lock, timeout=10):
    """Shared mkdir protocol with the TS runtime; never steal stale locks."""
    started = time.monotonic()
    while True:
        try:
            lock.mkdir(mode=0o700)
            break
        except FileExistsError:
            if lock.is_symlink() or not lock.is_dir():
                raise PlacementError('unsafe lock path')
            if time.monotonic() - started >= timeout:
                raise PlacementError('state lock unavailable; inspect interrupted or active writer')
            time.sleep(0.025)
    owner = lock / 'owner.json'
    try:
        with owner.open('x') as stream:
            os.chmod(owner, 0o600)
            json.dump({'pid': os.getpid(), 'host': socket.gethostname()}, stream)
        yield
    finally:
        owner.unlink(missing_ok=True)
        lock.rmdir()


class PlacementError(ValueError):
    pass


def git(project, *args, check=True):
    result = subprocess.run(['git', '-C', str(project), *args], capture_output=True, text=True)
    if check and result.returncode:
        raise PlacementError('Git inspection failed: ' + result.stderr.strip())
    return result


def git_path(project, name):
    raw = git(project, 'rev-parse', '--git-path', name).stdout.strip()
    path = Path(raw)
    return path if path.is_absolute() else (project / path).resolve()


def no_symlink_ancestors(path, boundary):
    current = path
    while current != boundary:
        if current.is_symlink():
            raise PlacementError('refusing a symlink in the placement path')
        if current == current.parent:
            raise PlacementError('placement escaped its scope')
        current = current.parent


def tree_digest(path):
    digest = hashlib.sha256()
    if path.is_symlink() or not path.is_dir():
        raise PlacementError('skill source must be a real directory')
    for item in sorted(path.rglob('*')):
        if item.is_symlink():
            raise PlacementError('user skill source links require explicit review before placement')
        if item.is_file():
            rel = item.relative_to(path).as_posix().encode()
            digest.update(len(rel).to_bytes(8, 'big') + rel)
            digest.update((item.stat().st_mode & 0o777).to_bytes(4, 'big'))
            data = item.read_bytes()
            digest.update(len(data).to_bytes(8, 'big') + data)
    return digest.hexdigest()


def validate_skill(path, name):
    body = path / 'SKILL.md'
    if body.is_symlink() or not body.is_file():
        raise PlacementError('SKILL.md is required')
    text = body.read_text()
    match = re.match(r'\A---\s*\n(.*?)\n---(?:\n|$)', text, re.S)
    if not match or not re.search(r'^name:\s*[\'"]?' + re.escape(name) + r'[\'"]?\s*$', match[1], re.M):
        raise PlacementError('SKILL.md frontmatter name must match the destination')
    if not re.search(r'^description:\s*\S', match[1], re.M):
        raise PlacementError('SKILL.md description is required')
    return tree_digest(path)


def replace_bytes(path, data):
    if path.is_symlink():
        raise PlacementError('refusing to replace a symlink')
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.jstack-write-')
    try:
        mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ignore_escape(path):
    # gitignore syntax: escape pattern operators, whitespace, and backslash.
    return '/' + ''.join('\\' + c if c in '\\*?[]!# ' else c for c in path)


class Placement:
    def __init__(self, name, scope, *, project=None, home=None, claude_home=None):
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name):
            raise PlacementError('skill name must be lower-case kebab-case')
        if scope not in {'project', 'global'}:
            raise PlacementError('an explicit project/global scope is required')
        self.name, self.scope = name, scope
        self.home = Path(home or Path.home()).expanduser().resolve()
        self.project = Path(project or Path.cwd()).expanduser().resolve()
        self.git_root = None
        if scope == 'project':
            result = git(self.project, 'rev-parse', '--show-toplevel', check=False)
            if result.returncode == 0:
                self.git_root = Path(result.stdout.strip()).resolve()
                # The plan's default scope is the Git top-level, not an inferred submodule.
                self.project = self.git_root
            self.canonical = self.project / '.agents/skills' / name
            self.link = self.project / '.claude/skills' / name
            self.boundaries = (self.project, self.project)
            self.exclude = git_path(self.project, 'info/exclude') if self.git_root else None
            self.state = git_path(self.project, 'jstack-skill-store.json') if self.git_root else self.project / '.jstack/skill-store.json'
        else:
            config = Path(claude_home or os.environ.get('CLAUDE_CONFIG_DIR') or self.home / '.claude').expanduser().absolute()
            self.canonical = self.home / '.agents/skills' / name
            self.link = config / 'skills' / name
            self.boundaries = (self.home, config)
            self.exclude = None
            self.state = self.home / '.jstack/skill-store.json'
        self.begin = f'# BEGIN jstack skill {name}\n'
        self.end = f'# END jstack skill {name}\n'

    def check_paths(self):
        for target, boundary in zip([self.canonical, self.link], self.boundaries):
            if boundary.is_symlink():
                raise PlacementError('scope root must not be a symlink')
            # The link itself is inspected separately.
            no_symlink_ancestors(target.parent, boundary)
        if self.canonical.is_symlink():
            raise PlacementError('canonical skill must not be a symlink')
        if self.link.is_symlink():
            expected = os.path.relpath(self.canonical, self.link.parent)
            if os.readlink(self.link) != expected or not self.link.exists():
                raise PlacementError('conflicting or broken link; preserve and inspect before repair')
        elif self.link.exists():
            raise PlacementError('host discovery path is occupied by a real file/directory')
        if self.exclude and self.exclude.is_symlink():
            raise PlacementError('Git exclude is a symlink')

    def tracked(self):
        if not self.git_root:
            return []
        paths = [p.relative_to(self.project).as_posix() for p in [self.canonical, self.link]]
        result = git(self.project, 'ls-files', '--', *paths)
        return result.stdout.splitlines()

    def exclusion(self, original, shared):
        text = original.decode()
        if self.begin in text or self.end in text:
            if text.count(self.begin) != 1 or text.count(self.end) != 1:
                raise PlacementError('ambiguous jstack exclude ownership block')
            start = text.index(self.begin)
            end = text.index(self.end, start) + len(self.end)
            text = text[:start] + text[end:]
        if not shared:
            if text and not text.endswith('\n'):
                text += '\n'
            patterns = [ignore_escape(p.relative_to(self.project).as_posix()) for p in [self.canonical, self.link]]
            text += self.begin + '\n'.join(patterns) + '\n' + self.end
        return text.encode()

    @contextmanager
    def locked(self):
        if self.state.is_symlink() or self.state.parent.is_symlink():
            raise PlacementError('ownership state must not be a symlink')
        self.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.state.with_suffix('.lock')
        fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            with portable_lock(Path(str(self.state) + '.lock-v2')):
                yield
        finally:
            os.close(fd)

    def inspection(self):
        self.check_paths()
        return {'scope': self.scope, 'canonical': str(self.canonical), 'claudeLink': str(self.link),
                'relativeTarget': os.path.relpath(self.canonical, self.link.parent),
                'canonicalExists': self.canonical.is_dir(), 'linked': self.link.is_symlink() and self.link.exists(),
                'tracked': self.tracked(), 'gitExclude': str(self.exclude) if self.exclude else None,
                'gitCommonDir': (git(self.project, 'rev-parse', '--git-common-dir').stdout.strip() if self.git_root else None),
                'verification': 'filesystem and Git only; host discovery is not yet proven',
                'limitations': ([] if self.git_root or self.scope == 'global' else ['No Git repository: future git init does not preserve local exclusion'])}

    def connect(self):
        """Repair host discovery without changing local/shared Git policy."""
        self.check_paths()
        validate_skill(self.canonical, self.name)
        if not self.link.is_symlink():
            with self.locked():
                self.check_paths()
                validate_skill(self.canonical, self.name)
                if not self.link.is_symlink():
                    self.link.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    self.link.symlink_to(os.path.relpath(self.canonical, self.link.parent), target_is_directory=True)
        result = self.inspection()
        result['sharing'] = 'unchanged'
        return result

    def place(self, source=None, *, shared=False):
        if self.scope == 'global' and shared:
            raise PlacementError('Git sharing applies only to project skills')
        source = Path(source).expanduser().resolve() if source else self.canonical
        self.check_paths()
        digest = validate_skill(source, self.name)
        if self.canonical.exists() and validate_skill(self.canonical, self.name) != digest:
            raise PlacementError('existing skill differs; preserve it and choose an explicit edit or a new name')
        if not shared and self.tracked():
            raise PlacementError('tracked skill cannot become local through exclude; automatic untracking is forbidden')
        with self.locked():
            # Recheck after lock acquisition; another jstack writer may have moved state.
            self.check_paths()
            if self.canonical.exists() and validate_skill(self.canonical, self.name) != digest:
                raise PlacementError('existing skill changed while waiting')
            original_exclude = self.exclude.read_bytes() if self.exclude and self.exclude.exists() else None
            original_state = self.state.read_bytes() if self.state.exists() else None
            state = json.loads(original_state) if original_state else {'schemaVersion': 1, 'skills': {}}
            if state.get('schemaVersion') != 1 or not isinstance(state.get('skills'), dict):
                raise PlacementError('unsupported skill ownership state')
            created, created_dirs, touched_exclude = [], [], False
            try:
                for parent in [self.canonical.parent, self.link.parent]:
                    absent = []
                    current = parent
                    while not current.exists():
                        absent.append(current)
                        current = current.parent
                    for path in reversed(absent):
                        path.mkdir(mode=0o700)
                        created_dirs.append(path)
                if not self.canonical.exists():
                    temporary = Path(tempfile.mkdtemp(prefix='.jstack-skill-', dir=self.canonical.parent))
                    try:
                        shutil.copytree(source, temporary / self.name, symlinks=False)
                        os.rename(temporary / self.name, self.canonical)
                    finally:
                        shutil.rmtree(temporary)
                    created.append(self.canonical)
                if not self.link.is_symlink():
                    self.link.symlink_to(os.path.relpath(self.canonical, self.link.parent), target_is_directory=True)
                    created.append(self.link)
                if self.exclude:
                    self.exclude.parent.mkdir(parents=True, exist_ok=True)
                    replace_bytes(self.exclude, self.exclusion(original_exclude or b'', shared))
                    touched_exclude = True
                    for target in [self.canonical / 'SKILL.md', self.link]:
                        ignored = git(self.project, 'check-ignore', '--no-index', '-q', '--', str(target), check=False)
                        if ignored.returncode not in {0, 1}:
                            raise PlacementError('Git ignore verification failed')
                        if shared and ignored.returncode == 0:
                            raise PlacementError('another ignore rule prevents sharing; rule was not changed')
                        if not shared and ignored.returncode != 0:
                            raise PlacementError('local exclusion was not effective')
                state['skills'][self.name] = {'scope': self.scope, 'digest': digest,
                                              'shared': shared, 'relativeTarget': os.path.relpath(self.canonical, self.link.parent)}
                replace_bytes(self.state, (json.dumps(state, indent=2) + '\n').encode())
            except BaseException:
                if touched_exclude:
                    if original_exclude is None:
                        self.exclude.unlink(missing_ok=True)
                    else:
                        replace_bytes(self.exclude, original_exclude)
                if original_state is not None:
                    replace_bytes(self.state, original_state)
                for path in reversed(created):
                    if path.is_symlink():
                        path.unlink()
                    elif path.is_dir():
                        shutil.rmtree(path)
                for path in reversed(created_dirs):
                    try:
                        path.rmdir()
                    except OSError:
                        pass
                raise
        result = self.inspection()
        result['sharing'] = 'shared' if shared else ('local' if self.scope == 'project' else 'global')
        result['digest'] = digest
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect', 'place', 'connect', 'share', 'local'])
    parser.add_argument('--scope', choices=['project', 'global'], required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--project')
    parser.add_argument('--home', help='test or selected user home')
    parser.add_argument('--claude-home', help='selected active Claude config directory')
    parser.add_argument('--source', type=Path)
    args = parser.parse_args(argv)
    try:
        placement = Placement(args.name, args.scope, project=args.project, home=args.home, claude_home=args.claude_home)
        if args.action == 'inspect':
            result = placement.inspection()
        else:
            if args.action == 'place' and not args.source:
                raise PlacementError('place requires --source')
            if args.action != 'place' and args.source:
                raise PlacementError('only place accepts --source')
            result = placement.connect() if args.action == 'connect' else placement.place(args.source, shared=args.action == 'share')
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (PlacementError, OSError, ValueError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
