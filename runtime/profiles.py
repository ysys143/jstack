#!/usr/bin/env python3
"""Private jstack profiles. No authentication material, remote writes, or host settings.

The CLI is the same on both hosts. Discovery returns candidates; save accepts
only an explicitly prepared profile, with optimistic concurrency protection.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
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
                raise ProfileError('unsafe lock path')
            if time.monotonic() - started >= timeout:
                raise ProfileError('state lock unavailable; inspect interrupted or active writer')
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


class ProfileError(ValueError):
    pass


NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\Z")
WS_FIELDS = {'schemaVersion', 'configDir', 'account', 'driveId', 'reportFolderId',
             'scrumFolderId', 'checkedAt', 'source', 'revision'}
REPORT_FIELDS = {'schemaVersion', 'subjectName', 'sheetNamePattern', 'nameColumn',
                 'dateColumn', 'learnedColumn', 'goalColumn', 'mailTo', 'revision'}


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def validate_name(name):
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ProfileError('profile name must use letters, digits, hyphens or underscores')
    return name


def check_owned(path, *, directory=False):
    """Reject symlinks, other owners, and publicly readable private state."""
    info = path.lstat()
    expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not expected or info.st_uid != os.getuid():
        raise ProfileError('private state must be an owned regular file/directory')
    if info.st_mode & 0o077:
        raise ProfileError('private state permissions must be 0700/0600; inspect before repair')


def private_dir(path):
    # Do not follow a symlink in an ancestor of the jstack state directory.
    for ancestor in reversed((path, *path.parents)):
        if ancestor.is_symlink():
            raise ProfileError('symlink in private state path')
    if not path.exists():
        path.mkdir(mode=0o700, parents=True)
    check_owned(path, directory=True)


def read_json(path):
    check_owned(path)
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise ProfileError('unreadable profile JSON') from exc
    if not isinstance(value, dict):
        raise ProfileError('profile must be a JSON object')
    return value


def atomic_write(path, data):
    if path.exists() or path.is_symlink():
        check_owned(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate(workspace, reporting):
    for data, fields in [(workspace, WS_FIELDS), (reporting, REPORT_FIELDS)]:
        if not isinstance(data, dict) or data.get('schemaVersion') != 1:
            raise ProfileError('unsupported profile schemaVersion')
        if set(data) - fields:
            raise ProfileError('unknown profile field; credentials and free-form instructions are not accepted')
        for key, value in data.items():
            if key in {'schemaVersion', 'revision'}:
                if type(value) is not int or value < (1 if key == 'schemaVersion' else 0):
                    raise ProfileError('invalid profile version/revision')
            elif not isinstance(value, str) or len(value) > 2048 or '\x00' in value:
                raise ProfileError('invalid profile field type or size')
    for field in ['configDir', 'account']:
        if not workspace.get(field):
            raise ProfileError('workspace requires configDir and an observed account identity')
    if not Path(workspace['configDir']).expanduser().is_absolute():
        raise ProfileError('configDir must be absolute')
    for field in ['nameColumn', 'dateColumn', 'learnedColumn', 'goalColumn']:
        if field in reporting and not re.fullmatch('[A-Z]{1,3}', reporting[field]):
            raise ProfileError('invalid Sheets column')


FILES = ['workspace.json', 'reporting.json', 'conventions.json']


SLUG = re.compile(r'[a-z][a-z0-9-]{0,19}', re.ASCII)
ISO = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})', re.ASCII)


def _iso(value):
    if not isinstance(value, str) or ISO.fullmatch(value) is None:
        return False
    try:
        dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    return True


def _slugs(value, minimum):
    return (isinstance(value, list) and minimum <= len(value) <= 20 and len(set(value)) == len(value)
            and all(isinstance(item, str) and SLUG.fullmatch(item) for item in value))


def _integer(value, low, high):
    # JSON 60.0 is the integer 60 in JavaScript, so the Node runtime accepts it; accept it here too.
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return type(value) is int and low <= value <= high


# Mirrors CONVENTION_FIELDS in profiles.ts; both twins must accept and reject the same files.
CONVENTION_FIELDS = {
    'schemaVersion': lambda v: type(v) is int and v == 1,
    'revision': lambda v: type(v) is int and v >= 0,
    'commitLanguage': lambda v: v in ('en', 'ko'),
    'autocommitLanguage': lambda v: v in ('en', 'ko'),
    'subjectVerbEnding': lambda v: v in ('none', 'korean'),
    'footerStyle': lambda v: v in ('conventional', 'resolves'),
    'branchScheme': lambda v: v in ('type-slash-desc', 'folder-category-desc'),
    'commitTypes': lambda v: _slugs(v, 1),
    'branchTypes': lambda v: _slugs(v, 1),
    'branchFolders': lambda v: _slugs(v, 0),
    'subjectMax': lambda v: _integer(v, 20, 200),
    'bodyWrap': lambda v: _integer(v, 40, 200),
    'source': lambda v: isinstance(v, str) and re.fullmatch(r'[a-z][a-z0-9-]{0,39}', v, re.ASCII) is not None,
    'checkedAt': _iso,
}


def check_conventions(conventions):
    if not isinstance(conventions, dict) or conventions.get('schemaVersion') != 1:
        raise ProfileError('unsupported conventions schemaVersion')
    for key, value in conventions.items():
        rule = CONVENTION_FIELDS.get(key)
        if rule is None:
            raise ProfileError('unknown conventions field; free-form instructions are not accepted')
        if not rule(value):
            raise ProfileError(f'invalid conventions field {key}')
    if conventions.get('branchScheme') == 'folder-category-desc' and not conventions.get('branchFolders'):
        raise ProfileError('folder-category-desc needs branchFolders')


def missing_fields(workspace, reporting):
    if workspace is None or reporting is None:
        return {'reportUpload': ['workspace.json'], 'scrum': ['workspace.json', 'reporting.json'],
                'draftMail': ['reporting.json']}
    return {
        'reportUpload': [k for k in ['reportFolderId'] if not workspace.get(k)],
        'scrum': ([k for k in ['scrumFolderId'] if not workspace.get(k)] +
                  [k for k in ['subjectName', 'sheetNamePattern', 'nameColumn',
                               'dateColumn', 'learnedColumn', 'goalColumn'] if not reporting.get(k)]),
        'draftMail': [k for k in ['mailTo'] if not reporting.get(k)],
    }


class Store:
    def __init__(self, root=None):
        self.root = Path(root or Path.home() / '.jstack').expanduser().absolute()

    def directory(self, name):
        return self.root / 'profiles' / validate_name(name)

    @contextmanager
    def lock(self, directory, *, create=False):
        if create:
            private_dir(self.root)
            private_dir(self.root / 'profiles')
            private_dir(directory)
        else:
            for path in [self.root, self.root / 'profiles', directory]:
                check_owned(path, directory=True)
        lock = directory / '.lock'
        flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CREAT
        try:
            fd = os.open(lock, flags, 0o600)
        except OSError as exc:
            raise ProfileError('profile lock unavailable; run explicit setup repair') from exc
        try:
            check_owned(lock)
            fcntl.flock(fd, fcntl.LOCK_EX)
            with portable_lock(directory / '.lock-v2'):
                yield
        finally:
            os.close(fd)

    @staticmethod
    def _present(directory):
        present = [(directory / f).exists() or (directory / f).is_symlink() for f in FILES]
        if present[0] != present[1]:
            raise ProfileError('partial profile exists; inspect before repair')
        return present

    def _read(self, name):
        directory = self.directory(name)
        if (directory / '.transaction.json').exists():
            raise ProfileError('interrupted profile transaction; run recover before use')
        pair, _, has_conventions = self._present(directory)
        if not pair and not has_conventions:
            raise ProfileError('profile has no settings')
        snapshot, revisions = {'profile': name}, []
        workspace = reporting = None
        if pair:
            workspace = read_json(directory / 'workspace.json')
            reporting = read_json(directory / 'reporting.json')
            validate(workspace, reporting)
            snapshot.update(workspace=workspace, reporting=reporting)
            revisions += [workspace.get('revision'), reporting.get('revision')]
        if has_conventions:
            conventions = read_json(directory / 'conventions.json')
            check_conventions(conventions)
            snapshot['conventions'] = conventions
            revisions.append(conventions.get('revision'))
        if not revisions[0] or any(value != revisions[0] for value in revisions):
            raise ProfileError('profile revisions do not match')
        snapshot['revision'] = revisions[0]
        snapshot['missing'] = missing_fields(workspace, reporting)
        return snapshot

    def load(self, name=None):
        if name is None:
            check_owned(self.root, directory=True)
            config = read_json(self.root / 'config.json')
            if type(config.get('schemaVersion')) is not int or config.get('schemaVersion') != 1 or set(config) != {'schemaVersion', 'defaultProfile'}:
                raise ProfileError('unsupported default profile configuration')
            name = validate_name(config['defaultProfile'])
        with self.lock(self.directory(name)):
            return self._read(name)

    def save(self, name, workspace, reporting, expected_revision, *, make_default=False):
        validate_name(name)
        validate(workspace, reporting)
        directory = self.directory(name)
        with self.lock(directory, create=True):
            if (directory / '.transaction.json').exists():
                raise ProfileError('interrupted profile transaction; recover explicitly')
            paths = [directory / x for x in FILES]
            existing = self._present(directory)
            current = self._read(name) if any(existing) else None
            old_revision = current['revision'] if current else 0
            if type(expected_revision) is not int or expected_revision != old_revision:
                raise ProfileError('profile changed; reread and resolve the conflict')
            revision = old_revision + 1
            # An existing conventions file is kept and rewritten at the new revision.
            conventions = current.get('conventions') if current else None
            new = [{**workspace, 'revision': revision}, {**reporting, 'revision': revision},
                   {**conventions, 'revision': revision} if conventions else None]
            previous = [p.read_text() if exists else None for p, exists in zip(paths, existing)]
            if current:
                kept = directory / 'history' / f'r{old_revision}'
                private_dir(directory / 'history')
                private_dir(kept)
                for filename, data in zip(FILES, previous):
                    if data is not None:
                        atomic_write(kept / filename, data.encode())
            journal = directory / '.transaction.json'
            atomic_write(journal, json_bytes({'schemaVersion': 1, 'files': FILES, 'previous': previous}))
            try:
                for path, data in zip(paths, new):
                    if data is not None:
                        atomic_write(path, json_bytes(data))
            except BaseException:
                self._restore(directory, previous)
                journal.unlink()
                raise
            journal.unlink()
            result = self._read(name)
        # The pointer is updated only after a committed, valid profile exists.
        if make_default:
            atomic_write(self.root / 'config.json', json_bytes({'schemaVersion': 1, 'defaultProfile': name}))
        return result

    @staticmethod
    def _restore(directory, previous, files=FILES):
        for filename, data in zip(files, previous):
            path = directory / filename
            if data is None:
                if path.exists():
                    check_owned(path)
                    path.unlink()
            else:
                atomic_write(path, data.encode())

    def recover(self, name):
        directory = self.directory(name)
        with self.lock(directory):
            journal = directory / '.transaction.json'
            data = read_json(journal)
            previous = data.get('previous')
            # Journals written before conventions existed name no files and hold the pair.
            files = data.get('files', FILES[:2])
            if (data.get('schemaVersion') != 1 or not isinstance(previous, list) or not isinstance(files, list)
                    or len(previous) != len(files) or files != FILES[:len(files)] or len(files) < 2):
                raise ProfileError('invalid recovery journal')
            if not all(value is None or isinstance(value, str) for value in previous):
                raise ProfileError('invalid recovery data')
            self._restore(directory, previous, files)
            journal.unlink()
        return {'profile': name, 'recovered': True}

    def inspect(self):
        if not self.root.exists():
            return {'configured': False, 'profiles': []}
        check_owned(self.root, directory=True)
        base = self.root / 'profiles'
        rows = []
        if base.exists():
            check_owned(base, directory=True)
            for path in sorted(base.iterdir()):
                try:
                    loaded = self.load(path.name)
                    row = {'profile': path.name, 'revision': loaded['revision'], 'missing': loaded['missing']}
                    if loaded.get('conventions'):
                        row['hasConventions'] = True
                    rows.append({**row, 'valid': True})
                except (ProfileError, OSError) as exc:
                    rows.append({'profile': path.name, 'valid': False, 'error': str(exc)})
        return {'configured': bool(rows), 'profiles': rows}


def account_env(config_dir):
    env = os.environ.copy()
    for key in list(env):
        if key.startswith('GOOGLE_WORKSPACE_CLI_') or key == 'GOOGLE_APPLICATION_CREDENTIALS':
            del env[key]
    env['GOOGLE_WORKSPACE_CLI_CONFIG_DIR'] = str(Path(config_dir).expanduser().absolute())
    return env


def gws_json(config_dir, args):
    """Read-only adapter. Keep credentials in the selected existing config store."""
    allowed = {('drive', 'about', 'get'), ('drive', 'drives', 'list'),
               ('drive', 'files', 'list'), ('drive', 'files', 'get'),
               ('sheets', 'spreadsheets', 'get')}
    if tuple(args[:3]) not in allowed:
        raise ProfileError('discovery accepts metadata reads only')
    config_dir = Path(config_dir).expanduser().absolute()
    if not config_dir.is_dir():
        raise ProfileError('selected account config directory does not exist')
    env = account_env(config_dir)
    try:
        result = subprocess.run(['gws', *args, '--format', 'json'], env=env,
                                capture_output=True, text=True, timeout=45)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProfileError('gws unavailable or metadata request timed out') from exc
    if result.returncode:
        # Raw stderr can contain private URLs or auth details. Do not persist it.
        raise ProfileError('gws metadata request failed; inspect authentication and access for the selected account')
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        raise ProfileError('gws returned non-JSON metadata') from exc
    if not isinstance(data, dict) or 'error' in data:
        raise ProfileError('gws returned invalid or failed metadata')
    return data


def identity(config_dir):
    raw = gws_json(config_dir, ['drive', 'about', 'get', '--params',
                              json.dumps({'fields': 'user(emailAddress,permissionId)'})])
    user = raw.get('user', {})
    account = user.get('permissionId') or user.get('emailAddress')
    if not isinstance(account, str) or not account:
        raise ProfileError('selected account identity could not be verified')
    return account


def discover(config_dir):
    account = identity(config_dir)
    # Explicit pagination; never claim a truncated candidate set is complete.
    groups = {}
    for resource, field, params in [
        ('drives', 'drives', {'pageSize': 100, 'fields': 'nextPageToken,drives(id,name)'}),
        ('files', 'files', {'pageSize': 100, 'fields': 'nextPageToken,files(id,name,mimeType,parents,driveId)',
                            'q': "trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.spreadsheet')",
                            'supportsAllDrives': True, 'includeItemsFromAllDrives': True})]:
        items, seen = [], set()
        for _ in range(100):
            raw = gws_json(config_dir, ['drive', resource, 'list', '--params', json.dumps(params)])
            batch = raw.get(field)
            if not isinstance(batch, list) or any(not isinstance(x, dict) for x in batch):
                raise ProfileError('invalid candidate list')
            keep = {'id', 'name', 'mimeType', 'parents', 'driveId'}
            items.extend({k: v for k, v in item.items() if k in keep} for item in batch)
            token = raw.get('nextPageToken')
            if not token:
                break
            if token in seen:
                raise ProfileError('metadata pagination repeated; candidate list incomplete')
            seen.add(token)
            params['pageToken'] = token
        else:
            raise ProfileError('candidate limit reached; narrow the selected account scope')
        groups[field] = items
    if identity(config_dir) != account:
        raise ProfileError('selected account changed during discovery')
    return {'schemaVersion': 1, 'configDir': str(Path(config_dir).expanduser().absolute()),
            'account': account, 'checkedAt': timestamp(), 'source': 'gws metadata',
            'candidates': groups, 'saved': False}


def verify_snapshot(snapshot):
    validate_name(snapshot['profile'])
    if not snapshot.get('workspace') or not snapshot.get('reporting'):
        raise ProfileError('profile has no workspace settings')
    validate(snapshot['workspace'], snapshot['reporting'])
    revision = snapshot.get('revision')
    if type(revision) is not int or revision < 1 or any(snapshot[k].get('revision') != revision for k in ['workspace', 'reporting']):
        raise ProfileError('snapshot revisions do not match')
    # Recheck actual account identity; do not reread the global default profile.
    workspace = snapshot['workspace']
    if identity(workspace['configDir']) != workspace['account']:
        raise ProfileError('account binding changed; stop the current task')
    return {'profile': snapshot['profile'], 'revision': snapshot['revision'], 'accountVerified': True}


def send_mail(snapshot, subject, body_file, recipient=None):
    """Explicit send action; never called by init/discover/inspect."""
    verify_snapshot(snapshot)
    recipient = recipient or snapshot['reporting'].get('mailTo')
    if not recipient or any(c in recipient for c in ['\r', '\n']) or any(c in subject for c in ['\r', '\n']):
        raise ProfileError('recipient and single-line subject are required')
    check_owned(body_file)
    try:
        result = subprocess.run(['gws', 'gmail', '+send', '--to', recipient,
                                 '--subject', subject, '--body', body_file.read_text()],
                                env=account_env(snapshot['workspace']['configDir']),
                                capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProfileError('mail request failed or timed out; inspect delivery before retrying') from exc
    if result.returncode:
        raise ProfileError('mail request failed; inspect delivery before retrying')
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        raise ProfileError('mail response could not be verified; do not blindly retry') from exc
    if not isinstance(data, dict) or not data.get('id'):
        raise ProfileError('mail response has no message ID; do not blindly retry')
    return {'sent': True, 'messageId': data['id'], 'profile': snapshot['profile'],
            'revision': snapshot['revision']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-root', help='private state root; default ~/.jstack')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('inspect')
    d = commands.add_parser('discover')
    d.add_argument('--config-dir', required=True)
    get = commands.add_parser('load')
    get.add_argument('--profile')
    save = commands.add_parser('save')
    save.add_argument('profile')
    save.add_argument('--workspace', type=Path, required=True)
    save.add_argument('--reporting', type=Path, required=True)
    save.add_argument('--expected-revision', type=int, required=True)
    save.add_argument('--default', action='store_true')
    recover = commands.add_parser('recover')
    recover.add_argument('profile')
    verify = commands.add_parser('verify-account')
    verify.add_argument('--snapshot', type=Path, required=True)
    mail = commands.add_parser('send-mail')
    mail.add_argument('--snapshot', type=Path, required=True)
    mail.add_argument('--subject', required=True)
    mail.add_argument('--body-file', type=Path, required=True)
    mail.add_argument('--to')
    args = parser.parse_args(argv)
    store = Store(args.state_root)
    try:
        if args.command == 'inspect':
            result = store.inspect()
        elif args.command == 'discover':
            result = discover(args.config_dir)
        elif args.command == 'load':
            result = store.load(args.profile)
        elif args.command == 'save':
            result = store.save(args.profile, read_json(args.workspace), read_json(args.reporting),
                                args.expected_revision, make_default=args.default)
        elif args.command == 'recover':
            result = store.recover(args.profile)
        elif args.command == 'send-mail':
            result = send_mail(read_json(args.snapshot), args.subject, args.body_file, args.to)
        else:
            result = verify_snapshot(read_json(args.snapshot))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ProfileError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
