#!/usr/bin/env python3
"""Exercise init's CLI sequence and account binding with an executable fake gws."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'runtime/profiles.py'


class Onboarding(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name).resolve()
        self.state = self.root / 'state'
        self.config = self.root / 'account'
        self.config.mkdir()
        (self.config / 'identity').write_text('fixture-account-a')
        self.log = self.root / 'gws-events.jsonl'
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        executable = bin_dir / 'gws'
        executable.write_text('#!' + sys.executable + '''
import json, os, sys
from pathlib import Path
config = Path(os.environ['GOOGLE_WORKSPACE_CLI_CONFIG_DIR'])
args = sys.argv[1:]
with open(os.environ['FIXTURE_GWS_LOG'], 'a') as stream:
    stream.write(json.dumps({'argv': args, 'config': str(config)}) + '\\n')
if args[:3] == ['drive', 'about', 'get']:
    print(json.dumps({'user': {'permissionId': (config / 'identity').read_text()}}))
elif args[:3] == ['drive', 'drives', 'list']:
    print(json.dumps({'drives': [{'id': 'fixture-drive', 'name': 'Work'}]}))
elif args[:3] == ['drive', 'files', 'list']:
    print(json.dumps({'files': [{'id': 'fixture-reports', 'name': 'Reports'}, {'id': 'fixture-scrum', 'name': 'Scrum'}]}))
elif args[:2] == ['gmail', '+send']:
    print(json.dumps({'id': 'fixture-message'}))
else:
    print(json.dumps({'error': 'unexpected operation'})); sys.exit(9)
''')
        executable.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ.get('PATH', ''),
                    'FIXTURE_GWS_LOG': str(self.log), 'PYTHONDONTWRITEBYTECODE': '1'}

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(TOOL), '--state-root', str(self.state), *args],
                              env=self.env, capture_output=True, text=True, timeout=20)

    def private_json(self, name, data):
        path = self.root / name
        path.write_text(json.dumps(data))
        path.chmod(0o600)
        return path

    def configure(self):
        discovery = self.run_cli('discover', '--config-dir', str(self.config))
        self.assertEqual(discovery.returncode, 0, discovery.stderr)
        data = json.loads(discovery.stdout)
        self.assertFalse(self.state.exists())
        workspace = self.private_json('workspace.json', {k: data[k] for k in ['schemaVersion', 'configDir', 'account', 'source', 'checkedAt']})
        reporting = self.private_json('reporting.json', {'schemaVersion': 1, 'subjectName': 'Example User', 'mailTo': 'recipient@example.invalid'})
        saved = self.run_cli('save', 'work', '--workspace', str(workspace), '--reporting', str(reporting), '--expected-revision', '0', '--default')
        self.assertEqual(saved.returncode, 0, saved.stderr)
        loaded = self.run_cli('load')
        self.assertEqual(loaded.returncode, 0, loaded.stderr)
        return self.private_json('snapshot.json', json.loads(loaded.stdout))

    def events(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_discovery_and_save_never_send_or_modify_remote_resources(self):
        self.configure()
        events = self.events()
        self.assertTrue(events)
        self.assertTrue(all(row['argv'][0] == 'drive' and row['argv'][2] in ['get', 'list'] for row in events))
        self.assertTrue(all(row['config'] == str(self.config) for row in events))
        inspection = self.run_cli('inspect')
        self.assertEqual(inspection.returncode, 0)
        self.assertEqual(self.events(), events)
        self.assertEqual(json.loads(inspection.stdout)['profiles'][0]['missing']['reportUpload'], ['reportFolderId'])

    def test_account_change_blocks_real_send_entrypoint(self):
        snapshot = self.configure()
        body = self.root / 'body.txt'
        body.write_text('Explicit synthetic draft')
        body.chmod(0o600)
        (self.config / 'identity').write_text('fixture-account-b')
        refused = self.run_cli('send-mail', '--snapshot', str(snapshot), '--subject', 'Fixture', '--body-file', str(body))
        self.assertNotEqual(refused.returncode, 0)
        self.assertFalse(any(row['argv'][0] == 'gmail' for row in self.events()))
        (self.config / 'identity').write_text('fixture-account-a')
        sent = self.run_cli('send-mail', '--snapshot', str(snapshot), '--subject', 'Fixture', '--body-file', str(body))
        self.assertEqual(sent.returncode, 0, sent.stderr)
        self.assertEqual(json.loads(sent.stdout)['messageId'], 'fixture-message')
        sends = [row for row in self.events() if row['argv'][0] == 'gmail']
        self.assertEqual(len(sends), 1)
        self.assertIn('recipient@example.invalid', sends[0]['argv'])

    def test_public_entry_instructions_preserve_scope_and_task_init(self):
        guide = (ROOT / 'runtime/ONBOARDING.md').read_text()
        capture = (ROOT / 'runtime/SKILL-STORAGE.md').read_text()
        for marker in ['Read', 'candidates', 'unset', 'existing', 'revision', 'verify-account', '~/.jstack/profiles/<name>/']:
            self.assertIn(marker, guide)
        self.assertLess(guide.index('inspect'), guide.index('discover'))
        self.assertLess(guide.index('discover'), guide.index(' save <profile>'))
        for marker in ['project/global', 'answer', 'Default local project storage', 'relative symlink', 'Never untrack automatically', 'without stage, commit, or\npush']:
            self.assertIn(marker, capture)
        command_root = ROOT / 'hosts/claude/commands'
        if not command_root.is_dir():
            command_root = ROOT / 'commands'
        init = (command_root / 'init.md').read_text()
        self.assertIn('workflow.py init', init.replace('skills/verify/scripts/', ''))
        self.assertIn('separate', init)
        self.assertIn('remote writes or mail delivery', init)


if __name__ == '__main__':
    unittest.main()
