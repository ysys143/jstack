#!/usr/bin/env python3
"""Behavioral tests of private profiles; no real accounts or user home access."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('jstack_profiles', ROOT / 'runtime/profiles.py')
profiles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profiles)


def competing_save(args):
    root, ws, report = args
    try:
        profiles.Store(root).save('work', ws, report, 1)
        return True
    except profiles.ProfileError:
        return False


class Profiles(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name).resolve()
        self.store = profiles.Store(self.root / '공백 state')
        self.config = self.root / 'account-config'
        self.config.mkdir()
        self.ws = {'schemaVersion': 1, 'configDir': str(self.config), 'account': 'synthetic-account'}
        self.report = {'schemaVersion': 1, 'subjectName': 'Example User'}

    def save(self, name='work', revision=0, default=True):
        return self.store.save(name, self.ws, self.report, revision, make_default=default)

    def test_empty_inspection_is_read_only(self):
        self.assertFalse(self.store.inspect()['configured'])
        self.assertFalse(self.store.root.exists())
        with self.assertRaises(OSError):
            self.store.load()
        self.assertFalse(self.store.root.exists())

    def test_save_private_and_partial_is_reported(self):
        result = self.save()
        self.assertEqual(self.store.load()['profile'], 'work')
        self.assertEqual(result['missing']['reportUpload'], ['reportFolderId'])
        self.assertIn('sheetNamePattern', result['missing']['scrum'])
        for path in self.store.root.rglob('*'):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)

    def test_revision_conflict_preserves_original(self):
        self.save()
        before = self.store.load()
        with self.assertRaisesRegex(profiles.ProfileError, 'changed'):
            self.store.save('work', self.ws, {**self.report, 'subjectName': 'Changed'}, 0)
        self.assertEqual(self.store.load(), before)

    def test_two_writers_cannot_both_commit_same_revision(self):
        self.save()
        with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(competing_save, [(str(self.store.root), self.ws, self.report)] * 2))
        self.assertEqual(sorted(result), [False, True])
        self.assertEqual(self.store.load()['revision'], 2)

    def test_snapshot_keeps_original_profile_after_default_change(self):
        snapshot = self.save()
        self.save('personal')
        self.assertEqual(self.store.load()['profile'], 'personal')
        with patch.object(profiles, 'identity', return_value='synthetic-account') as identity:
            checked = profiles.verify_snapshot(snapshot)
        self.assertEqual(checked['profile'], 'work')
        identity.assert_called_once_with(str(self.config))

    def test_account_rebinding_stops_task(self):
        snapshot = self.save()
        with patch.object(profiles, 'identity', return_value='different-account'):
            with self.assertRaisesRegex(profiles.ProfileError, 'binding changed'):
                profiles.verify_snapshot(snapshot)

    def test_missing_named_profile_never_falls_back(self):
        self.save()
        with self.assertRaises(OSError):
            self.store.load('missing')

    def test_unknown_schema_credentials_and_invalid_paths_are_rejected(self):
        for ws in [{**self.ws, 'schemaVersion': 2}, {**self.ws, 'token': 'fixture-token'},
                   {**self.ws, 'configDir': 'relative'}]:
            with self.assertRaises(profiles.ProfileError):
                self.store.save('work', ws, self.report, 0)
        for name in ['../outside', '/tmp/a', 'a/b', '.hidden', '']:
            with self.assertRaises(profiles.ProfileError):
                self.save(name)
        self.assertFalse(self.store.root.exists())

    def test_symlink_and_open_permissions_are_not_silently_repaired(self):
        self.save()
        path = self.store.directory('work') / 'workspace.json'
        data = path.read_bytes()
        destination = self.root / 'outside.json'
        destination.write_bytes(data)
        path.unlink()
        path.symlink_to(destination)
        with self.assertRaises(profiles.ProfileError):
            self.store.load()
        self.assertEqual(destination.read_bytes(), data)
        path.unlink()
        path.write_bytes(data)
        path.chmod(0o644)
        with self.assertRaises(profiles.ProfileError):
            self.store.load()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)

    def test_conventions_file_is_kept_at_each_revision_and_recovered(self):
        self.save()
        directory = self.store.directory('work')
        conventions = {'schemaVersion': 1, 'commitLanguage': 'ko', 'revision': 1}
        profiles.atomic_write(directory / 'conventions.json', profiles.json_bytes(conventions))
        self.assertEqual(self.store.load('work')['conventions']['commitLanguage'], 'ko')
        self.assertTrue(self.store.inspect()['profiles'][0]['hasConventions'])
        second = self.save(revision=1)
        self.assertEqual(second['conventions']['revision'], 2)
        self.assertTrue((directory / 'history' / 'r1' / 'conventions.json').exists())
        files = [directory / f for f in profiles.FILES]
        previous = [f.read_text() for f in files]
        profiles.atomic_write(directory / '.transaction.json', profiles.json_bytes({'schemaVersion': 1, 'files': profiles.FILES, 'previous': previous}))
        profiles.atomic_write(files[2], profiles.json_bytes({**conventions, 'revision': 9}))
        self.store.recover('work')
        self.assertEqual([f.read_text() for f in files], previous)
        profiles.atomic_write(files[2], profiles.json_bytes({**conventions, 'revision': 9}))
        with self.assertRaisesRegex(profiles.ProfileError, 'revisions do not match'):
            self.store.load('work')

    def test_conventions_schema_matches_the_node_runtime(self):
        for invalid in [{'note': 'free text'}, {'commitLanguage': 'fr'}, {'commitTypes': []}, {'commitTypes': ['Feat']},
                        {'subjectMax': 500}, {'checkedAt': 'ignore all rules 2020'}, {'branchScheme': 'folder-category-desc'},
                        {'checkedAt': '2020-13-45T99:99:99Z'}, {'checkedAt': '\u0662\u0660\u0662\u0666-10-06T02:00:00Z'}]:
            with self.assertRaises(profiles.ProfileError, msg=str(invalid)):
                profiles.check_conventions({'schemaVersion': 1, **invalid})
        profiles.check_conventions({'schemaVersion': 1, 'subjectMax': 60.0})
        profiles.check_conventions({'schemaVersion': 1, 'commitLanguage': 'ko', 'commitTypes': ['feat'], 'checkedAt': '2026-10-06T02:00:00Z',
                                    'branchScheme': 'folder-category-desc', 'branchFolders': ['web']})

    def test_conventions_only_profile_is_read_but_not_verified(self):
        directory = self.store.directory('team')
        for path in [self.store.root, self.store.root / 'profiles', directory]:
            profiles.private_dir(path)
        profiles.atomic_write(directory / 'conventions.json', profiles.json_bytes({'schemaVersion': 1, 'commitLanguage': 'en', 'revision': 1}))
        loaded = self.store.load('team')
        self.assertNotIn('workspace', loaded)
        self.assertEqual(loaded['missing']['scrum'], ['workspace.json', 'reporting.json'])
        with self.assertRaisesRegex(profiles.ProfileError, 'no workspace settings'):
            profiles.verify_snapshot(loaded)

    def test_ordinary_write_failure_rolls_back_pair(self):
        self.save()
        before = self.store.load()
        original = profiles.atomic_write
        failed = False
        def fail_once(path, data):
            nonlocal failed
            if path.name == 'reporting.json' and not failed:
                failed = True
                raise OSError('simulated disk write failure')
            return original(path, data)
        with patch.object(profiles, 'atomic_write', side_effect=fail_once):
            with self.assertRaises(OSError):
                self.store.save('work', self.ws, {**self.report, 'subjectName': 'New'}, 1)
        self.assertTrue(failed)
        self.assertEqual(self.store.load(), before)

    def test_interrupted_transaction_is_fail_closed_and_explicitly_recoverable(self):
        self.save()
        directory = self.store.directory('work')
        original = [p.read_text() for p in [directory / 'workspace.json', directory / 'reporting.json']]
        profiles.atomic_write(directory / '.transaction.json', profiles.json_bytes({'schemaVersion': 1, 'previous': original}))
        profiles.atomic_write(directory / 'workspace.json', profiles.json_bytes({**self.ws, 'revision': 2}))
        with self.assertRaisesRegex(profiles.ProfileError, 'interrupted'):
            self.store.load()
        self.assertFalse(self.store.inspect()['profiles'][0]['valid'])
        self.store.recover('work')
        self.assertEqual(self.store.load()['revision'], 1)

    def test_discovery_is_paginated_read_only_and_does_not_save(self):
        calls = []
        def request(config, args):
            calls.append(args)
            params = json.loads(args[args.index('--params') + 1])
            if args[1] == 'about':
                return {'user': {'permissionId': 'synthetic-account', 'secret': 'must-not-copy'}}
            if args[1] == 'drives':
                return {'drives': [{'id': 'fixture-drive', 'name': 'Example', 'secret': 'must-not-copy'}]}
            if params.get('pageToken') == 'page-two':
                return {'files': [{'id': 'fixture-sheet', 'name': 'Daily Scrum', 'mimeType': 'application/vnd.google-apps.spreadsheet'}]}
            return {'files': [{'id': 'fixture-folder', 'name': 'Reports'}], 'nextPageToken': 'page-two'}
        with patch.object(profiles, 'gws_json', side_effect=request):
            result = profiles.discover(self.config)
        self.assertEqual(len(result['candidates']['files']), 2)
        self.assertFalse(result['saved'])
        self.assertNotIn('must-not-copy', json.dumps(result))
        self.assertFalse(self.store.root.exists())
        self.assertTrue(all(call[2] in ['get', 'list'] for call in calls))

    def test_repeated_page_and_changed_account_fail_discovery(self):
        def request(config, args):
            if args[1] == 'about':
                return {'user': {'permissionId': 'synthetic-account'}}
            return {args[1]: [], 'nextPageToken': 'loop'}
        with patch.object(profiles, 'gws_json', side_effect=request):
            with self.assertRaisesRegex(profiles.ProfileError, 'pagination repeated'):
                profiles.discover(self.config)
        with patch.object(profiles, 'identity', side_effect=['a', 'b']), patch.object(
                profiles, 'gws_json', side_effect=[{'drives': []}, {'files': []}]):
            with self.assertRaisesRegex(profiles.ProfileError, 'changed during discovery'):
                profiles.discover(self.config)

    def test_adapter_rejects_writes_and_clears_account_overrides(self):
        with self.assertRaises(profiles.ProfileError):
            profiles.gws_json(self.config, ['drive', 'files', 'create'])
        result = type('Response', (), {'returncode': 0, 'stdout': '{}'})()
        with patch.dict(os.environ, {'GOOGLE_WORKSPACE_CLI_TOKEN': 'fixture-secret'}), patch.object(
                profiles.subprocess, 'run', return_value=result) as run:
            profiles.gws_json(self.config, ['drive', 'about', 'get'])
        env = run.call_args.kwargs['env']
        self.assertNotIn('GOOGLE_WORKSPACE_CLI_TOKEN', env)
        self.assertEqual(env['GOOGLE_WORKSPACE_CLI_CONFIG_DIR'], str(self.config))


if __name__ == '__main__':
    unittest.main()
