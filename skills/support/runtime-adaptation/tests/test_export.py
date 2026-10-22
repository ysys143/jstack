#!/usr/bin/env python3
"""Portable delivery tests: execute copied dependencies after hiding the source."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('jstack_export', SCRIPTS / 'export.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='jstack-export-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        (self.source / '.claude-plugin').mkdir(parents=True)
        (self.source / '.claude-plugin/plugin.json').write_text(json.dumps({
            'name': 'sample', 'version': '1.0.0', 'description': 'A sample plugin',
            'author': {'name': 'Test'}, 'experimental': {'evals': 'evals'}}))
        self.skill = self.source / 'skills' / 'sample'
        self.skill.mkdir(parents=True)
        (self.skill / 'SKILL.md').write_text(
            '---\nname: sample\ndescription: Check fixture behavior.\n---\n\n'
            'Run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/main.py"`.\n'
            'Read references/probe.md.\n')
        (self.skill / 'references').mkdir(parents=True)
        (self.skill / 'references/probe.md').write_text('relocated reference\n')
        (self.source / 'scripts').mkdir()
        (self.source / 'scripts/main.py').write_text(
            'from pathlib import Path\n'
            'print((Path(__file__).parent / "value.txt").read_text().strip())\n')
        (self.source / 'scripts/value.txt').write_text('independent payload\n')
        self.output = self.root / 'built package'

    def test_relocated_bundle_executes_without_original(self):
        exporter.export(self.source, self.output)
        moved = self.root / 'installed cache' / 'plugin'
        moved.parent.mkdir()
        self.output.rename(moved)
        shutil.rmtree(self.source)
        body = (moved / 'skills/sample/SKILL.md').read_text()
        self.assertNotIn('${CLAUDE_PLUGIN_ROOT}', body)
        self.assertNotIn(str(self.source), body)
        self.assertIn('payload', body)
        self.assertIn('<outer-root>/payload/skills/sample/', body)
        self.assertEqual(
            (moved / 'payload/skills/sample/references/probe.md').read_text(),
            'relocated reference\n')
        self.assertTrue((moved / 'payload/.claude-plugin/plugin.json').exists())
        command = body.split('Run `', 1)[1].split('`', 1)[0]
        env = {**os.environ, 'JSTACK_PLUGIN_ROOT': str(moved / 'payload')}
        result = subprocess.run(command, shell=True, cwd=self.root, env=env,
                                capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout.strip()),
                         (0, 'independent payload'))
        self.assertTrue(exporter.check(moved)['valid'])
        (moved / 'payload/scripts/value.txt').unlink()
        with self.assertRaisesRegex(ValueError, 'payload changed'):
            exporter.check(moved)
        broken = subprocess.run(command, shell=True, cwd=self.root, env=env,
                                capture_output=True, text=True)
        self.assertNotEqual(broken.returncode, 0)

    def test_native_entry_and_literal_are_preserved(self):
        (self.skill / 'SKILL.md').write_text('Task(subagent_type="x")')
        (self.skill / 'SKILL.codex.md').write_text(
            '---\nname: sample\ndescription: Test.\n---\n'
            'Use native agent tools. Reject `Generated with Claude Code`.\n')
        exporter.export(self.source, self.output)
        body = (self.output / 'skills/sample/SKILL.md').read_text()
        self.assertIn('native agent tools', body)
        self.assertNotIn('subagent_type', body)
        self.assertIn('Generated with Claude Code', body)

    def test_outer_discovery_is_flat_and_payload_keeps_nested_skills(self):
        nested = self.skill / 'references/nested'
        nested.mkdir(parents=True)
        (nested / 'SKILL.md').write_text(
            '---\nname: nested\ndescription: Nested source.\n---\nsource\n')
        (self.source / 'commands/check.md').parent.mkdir()
        (self.source / 'commands/check.md').write_text(
            '---\ndescription: Check command.\n---\nrun it\n')
        exporter.export(self.source, self.output)
        outer_entries = sorted(p.parent.name for p in (self.output / 'skills').glob('*/SKILL.md'))
        self.assertEqual(outer_entries, ['sample'])
        self.assertTrue((self.output / 'payload/commands/check.md').exists())
        self.assertTrue((self.output / 'payload/skills/sample/references/nested/SKILL.md').exists())
        self.assertFalse((self.output / 'skills/sample/references').exists())
        self.assertIn('Codex installed paths',
                      (self.output / 'skills/sample/SKILL.md').read_text())
        self.assertIn('<outer-root>/payload/skills/sample/',
                      (self.output / 'skills/sample/SKILL.md').read_text())
        self.assertNotIn('Codex installed paths',
                         (self.output / 'payload/skills/sample/SKILL.md').read_text())

    def test_reachable_host_blocker_requires_native_entry(self):
        (self.skill / 'references/execute.md').write_text('Use Task(subagent_type="x")')
        with (self.skill / 'SKILL.md').open('a') as out:
            out.write('Read references/execute.md\n')
        with self.assertRaisesRegex(ValueError, 'native entry required'):
            exporter.export(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_manifest_registration_and_receipt(self):
        (self.source / 'README.md').write_text(
            'Run scripts/main.py and read references/probe.md.\n')
        (self.source / 'hooks').mkdir()
        (self.source / 'hooks/hooks.json').write_text('{"hooks": {}}')
        (self.source / 'commands').mkdir()
        (self.source / 'commands/unsafe.md').write_text('Task(subagent_type="x")')
        receipt = exporter.export(self.source, self.output)
        manifest = json.loads((self.output / '.codex-plugin/plugin.json').read_text())
        self.assertNotIn('experimental', manifest)
        self.assertEqual(manifest['version'], '1.0.0')
        self.assertEqual(manifest['skills'], './skills/')
        self.assertFalse((self.output / '.claude-plugin/plugin.json').exists())
        self.assertFalse((self.output / 'hooks/hooks.json').exists())
        self.assertFalse((self.output / 'commands').exists())
        self.assertTrue((self.output / 'payload/.claude-plugin/plugin.json').exists())
        self.assertTrue((self.output / 'payload/commands/unsafe.md').exists())
        self.assertIn('public entrypoint', (self.output / 'README.md').read_text())
        self.assertIn('Claude tool hooks', receipt['unavailableAutomaticSurfaces'])
        (self.output / '.codex-plugin/plugin.json').unlink()
        with self.assertRaises(ValueError):
            exporter.check(self.output)

    def test_claude_team_lifecycle_is_not_a_native_capability(self):
        with (self.skill / 'SKILL.md').open('a') as out:
            out.write('Use `TeamCreate` to create reviewers.\n')
        with self.assertRaisesRegex(ValueError, 'team lifecycle'):
            exporter.export(self.source, self.output)

    def test_refuses_existing_destination_without_changes(self):
        self.output.mkdir()
        marker = self.output / 'user.txt'
        marker.write_text('keep')
        with self.assertRaises(ValueError):
            exporter.export(self.source, self.output)
        self.assertEqual(marker.read_text(), 'keep')

    def test_refuses_recursive_destination(self):
        with self.assertRaises(ValueError):
            exporter.export(self.source, self.source / 'generated')

    def test_escaping_symlink_is_rejected(self):
        outside = self.root / 'private.txt'
        outside.write_text('outside source')
        (self.skill / 'leak.txt').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'unsafe symlink'):
            exporter.export(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_internal_relative_link_survives(self):
        (self.skill / 'data.txt').write_text('payload')
        (self.skill / 'alias.txt').symlink_to('data.txt')
        (self.skill / 'target-dir').mkdir()
        (self.skill / 'target-dir/value.txt').write_text('directory payload')
        (self.skill / 'dir-alias').symlink_to('target-dir', target_is_directory=True)
        exporter.export(self.source, self.output)
        self.assertEqual((self.output / 'payload/skills/sample/alias.txt').read_text(), 'payload')
        alias = self.output / 'payload/skills/sample/alias.txt'
        dir_alias = self.output / 'payload/skills/sample/dir-alias'
        self.assertFalse(alias.is_symlink())
        self.assertFalse(dir_alias.is_symlink())
        self.assertEqual((dir_alias / 'value.txt').read_text(), 'directory payload')
        self.assertTrue(exporter.check(self.output)['valid'])
        alias.unlink()
        alias.symlink_to('/etc/hosts')
        with self.assertRaises(ValueError):
            exporter.check(self.output)

    def test_cache_is_excluded_and_missing_entry_fails(self):
        (self.skill / '__pycache__').mkdir()
        (self.skill / '__pycache__/stale.pyc').write_bytes(b'cache')
        exporter.export(self.source, self.output)
        self.assertFalse((self.output / 'payload/skills/sample/__pycache__').exists())
        (self.skill / 'SKILL.md').unlink()
        with self.assertRaisesRegex(ValueError, 'no skills'):
            exporter.export(self.source, self.root / 'empty')


if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ExportTests))
    print(f'{result.testsRun - len(result.failures) - len(result.errors)}/{result.testsRun} passed')
    raise SystemExit(0 if result.wasSuccessful() else 1)
