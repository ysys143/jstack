import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { atomicWrite, privateDir } from '../runtime/os.js';
import { initialize } from './init.js';

function fixture(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-init-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const codex = join(home, '.agents'); mkdirSync(codex, { recursive: true });
  const skill = (version: string, name: string) => {
    const file = join(codex, 'plugins/cache/remote/design', version, 'skills', name, 'SKILL.md'); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '---\nname: x\n---\n'); return file;
  };
  return { home, codex, skill };
}

test('init captures portable plugin defaults privately and is idempotent', t => {
  const f = fixture(t), one = f.skill('1.0.0', 'one'), two = f.skill('1.0.0', 'two');
  writeFileSync(join(f.codex, 'config.toml'), `model = "test"\n\n[[skills.config]]\npath = ${JSON.stringify(one)}\nenabled = false\n\n[[skills.config]]\npath = ${JSON.stringify(two)}\nenabled = false\n`);
  const first: any = initialize({ home: f.home, hosts: ['codex'], capture: true });
  assert.equal(first.captured, true); assert.equal(first.pluginDefaults, 1); assert.equal(first.hosts[0].applied, 0);
  const saved = readFileSync(first.preferenceFile, 'utf8'); assert.ok(!saved.includes(f.home)); assert.ok(!saved.includes('1.0.0')); assert.match(saved, /"disabledSkills": "all"/);
  if (process.platform !== 'win32') { assert.equal(statSync(first.preferenceFile).mode & 0o777, 0o600); assert.equal(statSync(join(f.home, '.jstack/preferences')).mode & 0o777, 0o700); }
  const before = readFileSync(join(f.codex, 'config.toml'));
  const second: any = initialize({ home: f.home, hosts: ['codex'] }); assert.equal(second.captured, false); assert.equal(second.hosts[0].applied, 0); assert.deepEqual(readFileSync(join(f.codex, 'config.toml')), before);
});

test('init applies a group to a new version while preserving an explicit enabled override', t => {
  const source = fixture(t), one = source.skill('1.0.0', 'one'), two = source.skill('1.0.0', 'two');
  writeFileSync(join(source.codex, 'config.toml'), `title = "keep exactly"\n\n[[skills.config]]\npath = ${JSON.stringify(one)}\nenabled = false\n\n[[skills.config]]\npath = ${JSON.stringify(two)}\nenabled = false\n`);
  initialize({ home: source.home, hosts: ['codex'], capture: true });
  const targetHome = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-init-target-'))); t.after(() => rmSync(targetHome, { recursive: true, force: true }));
  privateDir(join(targetHome, '.jstack/preferences'));
  const preference = join(source.home, '.jstack/preferences/codex-skill-defaults.json'); atomicWrite(join(targetHome, '.jstack/preferences/codex-skill-defaults.json'), readFileSync(preference));
  const target = join(targetHome, '.agents'), currentOne = join(target, 'plugins/cache/remote/design/2.0.0/skills/one/SKILL.md'), currentTwo = join(target, 'plugins/cache/remote/design/2.0.0/skills/two/SKILL.md');
  for (const file of [currentOne, currentTwo]) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, 'skill'); }
  writeFileSync(join(target, 'config.toml'), `title = "keep exactly"\n\n[[skills.config]]\npath = ${JSON.stringify(currentOne)}\nenabled = true\n`);
  const result: any = initialize({ home: targetHome, hosts: ['codex'] }), text = readFileSync(join(target, 'config.toml'), 'utf8');
  assert.equal(result.hosts[0].applied, 1); assert.equal(result.hosts[0].preservedOverrides, 1); assert.ok(text.startsWith('title = "keep exactly"')); assert.ok(((parseToml(text) as any).skills.config as { path: string }[]).some(row => row.path === currentTwo)); assert.equal((parseToml(text) as any).skills.config.length, 2);
});

test('init fails closed on missing capture input and malformed host config', t => {
  const f = fixture(t); assert.throws(() => initialize({ home: f.home, hosts: ['codex'], capture: true }), /no disabled plugin skills/); assert.equal(existsSync(join(f.home, '.jstack/preferences/codex-skill-defaults.json')), false);
  writeFileSync(join(f.codex, 'config.toml'), 'broken = "\n'); assert.throws(() => initialize({ home: f.home, hosts: ['codex'], capture: true }), /invalid TOML/);
});

test('Claude-only init is a read-only no-op for Codex preferences', t => {
  const f = fixture(t), result: any = initialize({ home: f.home, hosts: ['claude'] });
  assert.equal(result.hosts[0].status, 'not-applicable'); assert.equal(existsSync(join(f.home, '.jstack')), false);
  assert.throws(() => initialize({ home: f.home, hosts: ['claude'], capture: true }), /requires the Codex host/);
});
