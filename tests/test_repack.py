#!/usr/bin/env python3
"""Independent failure controls for packaging and private-data boundaries."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load('jstack_builder', ROOT / 'packaging/build.py')
suite = load('jstack_suite', ROOT / 'skills/_suite_lib.py')
release = load('jstack_release', ROOT / 'packaging/release.py')


class Repack(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.addCleanup(self.box.cleanup)
        self.root = Path(self.box.name).resolve()
        self.source = self.root / 'source'
        (self.source / 'skills/example/scripts').mkdir(parents=True)
        (self.source / 'skills/example/SKILL.md').write_text('---\nname: example\ndescription: Fixture skill\n---\nRun scripts/hello.py.\n')
        (self.source / 'skills/example/scripts/hello.py').write_text('print("fixture")\n')
        (self.source / 'runtime').mkdir()
        (self.source / 'runtime/profiles.py').write_text('print("fixture runtime")\n')
        (self.source / 'packaging').mkdir()
        for name in ['build.py', 'check_public.py']:
            shutil.copy2(ROOT / 'packaging' / name, self.source / 'packaging' / name)
        builder.write_json(self.source / 'packaging/product.json', {
            'name': 'jstack', 'version': '0.0.1', 'description': 'Fixture package', 'author': {'name': 'Fixture'}})
        self.manifest()
        self.package = self.root / 'jstack'

    def manifest(self):
        builder.write_json(self.source / 'packaging/package-files.json', builder.discover_membership(self.source))

    def build(self):
        return builder.build(self.source, self.package)

    def test_dual_entry_build_is_source_independent_and_refuses_overwrite(self):
        result = self.build()
        self.assertEqual(result['publicSkills'], 1)
        self.assertTrue(builder.check(self.package)['passed'])
        with self.assertRaisesRegex(builder.BuildError, 'must not exist'):
            self.build()
        shutil.rmtree(self.source)
        self.assertTrue(builder.check(self.package)['passed'])
        for host in ['claude', 'codex']:
            entry = self.package / 'entries' / host / 'example/SKILL.md'
            self.assertIn('skills/example/', entry.read_text())
            self.assertNotIn(str(self.root), entry.read_text())
        claude = json.loads((self.package / '.claude-plugin/plugin.json').read_text())
        codex = json.loads((self.package / '.codex-plugin/plugin.json').read_text())
        self.assertEqual(claude['skills'], ['./entries/claude'])
        self.assertEqual(codex['skills'], './entries/codex')

    def test_undeclared_source_fails_without_refreshing_inventory(self):
        extra = self.source / 'runtime/undeclared.py'
        extra.write_text('print("not in the reviewed list")\n')
        before = (self.source / 'packaging/package-files.json').read_bytes()
        with self.assertRaisesRegex(builder.BuildError, 'membership drift'):
            self.build()
        self.assertEqual((self.source / 'packaging/package-files.json').read_bytes(), before)
        self.assertFalse(self.package.exists())

    def test_release_binds_both_registries_and_rejects_unlisted_delivery_files(self):
        delivery = self.root / 'release'
        result = release.create(self.source, delivery)
        self.assertTrue(result['passed'])
        self.assertTrue(release.check(delivery)['passed'])
        with self.assertRaisesRegex(ValueError, 'must not exist'):
            release.create(self.source, delivery)
        extra = delivery / 'unreviewed-note.txt'
        extra.write_text('Not part of the approved delivery surface.')
        with self.assertRaisesRegex(ValueError, 'unexpected release file'):
            release.check(delivery)
        extra.unlink()
        registry = delivery / '.agents/plugins/marketplace.json'
        content = json.loads(registry.read_text())
        content['plugins'][0]['source']['path'] = './plugins/other'
        registry.write_text(json.dumps(content))
        with self.assertRaisesRegex(ValueError, 'registry differs'):
            release.check(delivery)

    def test_added_file_fails_even_when_receipt_is_rehashed(self):
        self.build()
        (self.package / 'surprise.txt').write_text('unlisted data')
        receipt_path = self.package / builder.RECEIPT
        receipt = json.loads(receipt_path.read_text())
        receipt['files'] = builder.digest_files(self.package)
        builder.write_json(receipt_path, receipt)
        with self.assertRaisesRegex(builder.BuildError, 'membership differs'):
            builder.check(self.package)

    def test_deleted_checker_and_changed_runtime_fail(self):
        self.build()
        checker = self.package / 'payload/packaging/check_public.py'
        before = checker.read_bytes()
        checker.unlink()
        with self.assertRaisesRegex(builder.BuildError, 'checker missing'):
            builder.check(self.package)
        checker.write_bytes(before)
        script = self.package / 'payload/runtime/profiles.py'
        script.write_text('print("changed")')
        with self.assertRaisesRegex(builder.BuildError, 'differ from the receipt'):
            builder.check(self.package)

    def test_internal_links_materialize_and_external_links_fail(self):
        link = self.source / 'skills/example/scripts/linked.py'
        link.symlink_to('hello.py')
        self.manifest()
        self.build()
        destination = self.package / 'payload/skills/example/scripts/linked.py'
        self.assertFalse(destination.is_symlink())
        self.assertEqual(destination.read_bytes(), (self.source / 'skills/example/scripts/hello.py').read_bytes())
        link.unlink()
        link.symlink_to(self.root / 'external')
        with self.assertRaises(builder.BuildError):
            builder.discover_membership(self.source)

    def test_reviewed_discovery_alias_exclusion_preserves_canonical_and_detects_drift(self):
        alias = self.source / 'skills/compatibility-alias'
        alias.symlink_to('example', target_is_directory=True)
        builder.write_json(self.source / 'packaging/excluded-aliases.json', [{
            'source': 'skills/compatibility-alias', 'canonical': 'skills/example',
            'reason': 'Discovery alias; canonical resources are retained.'}])
        members = builder.discover_membership(self.source)['files']
        self.assertTrue(any(row['source'] == 'skills/example/SKILL.md' for row in members))
        self.assertFalse(any('compatibility-alias' in row['source'] for row in members))
        alias.unlink()
        alias.mkdir()
        (alias / 'SKILL.md').write_text('Independent content must not silently disappear.')
        with self.assertRaisesRegex(builder.BuildError, 'excluded alias'):
            builder.discover_membership(self.source)

    def test_private_values_in_reference_fixture_or_generated_tree_fail(self):
        value = 'fixture-' + 'business-resource-' + 'not-for-public'
        for relative in ['skills/example/references/data.md', 'tests/refs/data.lines']:
            with self.subTest(path=relative):
                path = self.source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value)
                self.manifest()
                with self.assertRaisesRegex(builder.BuildError, 'publication boundary'):
                    builder.build(self.source, self.package, [value])
                self.assertFalse(self.package.exists())
                path.unlink()
        self.manifest()
        self.build()
        path = self.package / 'payload/skills/example/scripts/hello.py'
        path.write_text(value)
        report = builder.public.inspect(self.package, [value])
        self.assertFalse(report['passed'])
        self.assertTrue(any(row['kind'] == 'private comparison match' for row in report['findings']))
        self.assertNotIn(value, json.dumps(report))

    def test_public_scanner_fails_empty_state_credentials_and_live_shaped_ids(self):
        public_root = self.root / 'publication'
        public_root.mkdir()
        self.assertFalse(builder.public.inspect(public_root)['passed'])
        path = public_root / 'example.md'
        values = ['sk-' + 'aB3z' * 9, '`1' + 'aB3z_' * 6 + '`']
        for value in values:
            path.write_text(value)
            self.assertFalse(builder.public.inspect(public_root)['passed'])
        path.write_text('Example account: you@example.com\nhttps://github.com/example/project\nCopyright Example\n')
        self.assertTrue(builder.public.inspect(public_root)['passed'])
        state = public_root / '.jstack/config.json'
        state.parent.mkdir()
        state.write_text('{}')
        self.assertFalse(builder.public.inspect(public_root)['passed'])

    def test_both_root_spellings_check_dependencies_without_losing_deleted_population(self):
        skill = self.source / 'skills/example'
        def results(body):
            rows = []
            suite.check_body_paths(lambda *row: rows.append(row), str(skill), body)
            return rows
        label = '본문 계약: 실행 경로의 대상 파일이 실재한다'
        for token in ['JSTACK_PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT']:
            body = f'Read `${{{token}}}/runtime/profiles.py` and `${{{token}}}/skills/example/scripts/hello.py`.'
            baseline = results(body)
            self.assertTrue(next(row[1] for row in baseline if row[0] == label))
            for target in ['runtime/profiles.py', 'skills/example/scripts/hello.py']:
                changed = results(body.replace(target, target + '.missing'))
                self.assertFalse(next(row[1] for row in changed if row[0] == label))
            deleted = results('')
            self.assertEqual([row[0] for row in baseline], [row[0] for row in deleted])
            self.assertTrue(all(not row[1] for row in deleted))

    def test_root_spelling_does_not_change_semantic_floor_but_deletion_does(self):
        old = 'Read `${CLAUDE_PLUGIN_ROOT}/runtime/check.py` before modifying anything.'
        new = old.replace('CLAUDE_PLUGIN_ROOT', 'JSTACK_PLUGIN_ROOT')
        self.assertEqual(suite.content_bytes(old), suite.content_bytes(new))
        self.assertLess(suite.content_bytes('Read `${JSTACK_PLUGIN_ROOT}/runtime/check.py`.'), suite.content_bytes(old))
        self.assertEqual(suite.content_bytes(new + '\n' + new), suite.content_bytes(new))


if __name__ == '__main__':
    unittest.main()
