#!/usr/bin/env python3
"""Skill placement and Git boundary tests in disposable repositories."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('jstack_skill_store', ROOT / 'runtime/skill_store.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], capture_output=True, check=True, text=True).stdout


class SkillStore(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name).resolve()
        self.repo = self.root / '공백 repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        self.source = self.root / 'source'
        self.source.mkdir()
        (self.source / 'SKILL.md').write_text('---\nname: sample\ndescription: Test fixture skill\n---\n\n# Example\n')
        (self.source / 'script.sh').write_text('#!/bin/sh\nprintf example\n')
        (self.source / 'script.sh').chmod(0o755)
        self.p = module.Placement('sample', 'project', project=self.repo)

    def test_local_exact_exclude_preserves_other_skills_and_index(self):
        before = git(self.repo, 'ls-files', '--stage')
        result = self.p.place(self.source)
        self.assertEqual(result['relativeTarget'], '../../.agents/skills/sample')
        self.assertEqual((self.p.canonical / 'script.sh').stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.p.link.resolve(), self.p.canonical)
        self.assertEqual(git(self.repo, 'ls-files', '--stage'), before)
        other = self.repo / '.agents/skills/other/SKILL.md'
        other.parent.mkdir(parents=True)
        other.write_text('example')
        git(self.repo, 'add', '.')
        names = git(self.repo, 'ls-files')
        self.assertIn('.agents/skills/other/SKILL.md', names)
        self.assertNotIn('sample', names)

    def test_share_removes_only_owned_block_and_git_records_relative_link(self):
        original = b'# unrelated\n*.tmp\n'
        self.p.exclude.write_bytes(original)
        self.p.place(self.source)
        result = self.p.place(shared=True)
        self.assertEqual(result['sharing'], 'shared')
        self.assertEqual(self.p.exclude.read_bytes(), original)
        git(self.repo, 'add', '.agents/skills/sample', '.claude/skills/sample')
        index = git(self.repo, 'ls-files', '--stage')
        self.assertIn('120000', index)
        link = git(self.repo, 'show', ':.claude/skills/sample')
        self.assertEqual(link, '../../.agents/skills/sample')
        self.assertFalse((self.repo / 'CLAUDE.md').exists())
        self.assertFalse((self.repo / 'AGENTS.md').exists())

    def test_connect_preserves_shared_exclude_and_ownership(self):
        self.p.place(self.source, shared=True)
        self.p.link.unlink()
        exclude, state = self.p.exclude.read_bytes(), self.p.state.read_bytes()
        result = self.p.connect()
        self.assertEqual(self.p.exclude.read_bytes(), exclude)
        self.assertEqual(self.p.state.read_bytes(), state)
        self.assertEqual(self.p.link.resolve(), self.p.canonical)
        self.assertEqual(result['sharing'], 'unchanged')

    def test_connect_repairs_tracked_skill_without_index_change(self):
        self.p.place(self.source, shared=True)
        git(self.repo, 'add', '.agents/skills/sample', '.claude/skills/sample')
        before = git(self.repo, 'ls-files', '--stage')
        self.p.link.unlink()
        self.p.connect()
        self.assertEqual(git(self.repo, 'ls-files', '--stage'), before)
        self.assertEqual(self.p.link.resolve(), self.p.canonical)

    def test_tracked_skill_cannot_be_hidden_by_local_transition(self):
        self.p.place(self.source, shared=True)
        git(self.repo, 'add', '.')
        before = git(self.repo, 'ls-files', '--stage')
        with self.assertRaisesRegex(module.PlacementError, 'tracked'):
            self.p.place()
        self.assertEqual(git(self.repo, 'ls-files', '--stage'), before)

    def test_other_ignore_rule_blocks_share_and_rolls_back(self):
        (self.repo / '.gitignore').write_text('.agents/\n')
        self.p.place(self.source)
        before = self.p.exclude.read_bytes()
        state = self.p.state.read_bytes()
        with self.assertRaisesRegex(module.PlacementError, 'another ignore'):
            self.p.place(shared=True)
        self.assertEqual(self.p.exclude.read_bytes(), before)
        self.assertEqual(self.p.state.read_bytes(), state)
        self.assertEqual((self.repo / '.gitignore').read_text(), '.agents/\n')

    def test_idempotent_and_different_existing_source_preserved(self):
        self.p.place(self.source)
        self.p.place(self.source)
        (self.source / 'SKILL.md').write_text((self.source / 'SKILL.md').read_text() + 'Changed\n')
        before = (self.p.canonical / 'SKILL.md').read_bytes()
        with self.assertRaisesRegex(module.PlacementError, 'existing skill differs'):
            self.p.place(self.source)
        self.assertEqual((self.p.canonical / 'SKILL.md').read_bytes(), before)

    def test_conflicting_and_broken_links_preserved(self):
        self.p.link.parent.mkdir(parents=True)
        self.p.link.symlink_to('../../missing')
        with self.assertRaisesRegex(module.PlacementError, 'broken link'):
            self.p.place(self.source)
        self.assertEqual(os.readlink(self.p.link), '../../missing')
        self.assertFalse(self.p.canonical.exists())

    def test_real_host_directory_preserved(self):
        self.p.link.mkdir(parents=True)
        (self.p.link / 'personal.md').write_text('keep')
        with self.assertRaises(module.PlacementError):
            self.p.place(self.source)
        self.assertEqual((self.p.link / 'personal.md').read_text(), 'keep')

    def test_failure_rolls_back_new_files_and_keeps_exclude(self):
        before = self.p.exclude.read_bytes()
        original = module.replace_bytes
        def fail_state(path, data):
            if path == self.p.state:
                raise OSError('simulated state write failure')
            return original(path, data)
        with patch.object(module, 'replace_bytes', side_effect=fail_state):
            with self.assertRaises(OSError):
                self.p.place(self.source)
        self.assertFalse(self.p.canonical.exists())
        self.assertFalse(self.p.link.is_symlink())
        self.assertEqual(self.p.exclude.read_bytes(), before)

    def test_global_uses_active_claude_home_without_extra_codex_copy(self):
        home = self.root / 'home'
        home.mkdir()
        config = home / '.claude-work'
        p = module.Placement('sample', 'global', home=home, claude_home=config)
        result = p.place(self.source)
        self.assertEqual(p.canonical, home / '.agents/skills/sample')
        self.assertEqual(p.link, config / 'skills/sample')
        self.assertEqual(p.link.resolve(), p.canonical)
        self.assertFalse((home / '.codex/skills/sample').exists())
        self.assertEqual(result['sharing'], 'global')

    def test_non_git_warns_future_init_not_protected(self):
        project = self.root / 'no-git'
        project.mkdir()
        p = module.Placement('sample', 'project', project=project)
        result = p.place(self.source)
        self.assertIn('future git init', result['limitations'][0])
        self.assertIsNone(result['gitExclude'])

    def test_worktree_resolves_real_exclude_and_reports_common_directory(self):
        git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
            'commit', '--allow-empty', '-qm', 'test: fixture')
        worktree = self.root / 'worktree'
        git(self.repo, 'worktree', 'add', '-qb', 'fixture-worktree', str(worktree))
        p = module.Placement('sample', 'project', project=worktree)
        result = p.place(self.source)
        self.assertTrue((worktree / '.git').is_file())
        self.assertEqual(p.exclude.resolve(), self.p.exclude.resolve())
        self.assertIsNotNone(result['gitCommonDir'])
        self.assertEqual(p.link.resolve(), p.canonical)

    def test_source_symlink_and_invalid_name_refused(self):
        (self.source / 'outside').symlink_to(self.root / 'outside')
        with self.assertRaises(module.PlacementError):
            self.p.place(self.source)
        with self.assertRaises(module.PlacementError):
            module.Placement('../outside', 'project', project=self.repo)
        self.assertFalse(self.p.canonical.exists())


if __name__ == '__main__':
    unittest.main()
