import test from 'node:test';
import { checkPluginPaths } from '../scripts/check_plugin_paths.js';
import { jstackSurface } from '../skills/support/host-audit/scripts/analyze.js';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPackage, writeJson, discoverMembership, digestFiles, checkPackage } from './build.js';
import { CATALOG_PATH, catalogExports, validateCatalog, type SkillCatalog } from '../runtime/skill_catalog.js';
function contract(): SkillCatalog { return { schemaVersion: 1, categories: ['workflow'], entries: [
  { owner: 'audit', name: 'review', visibility: 'public', category: 'workflow', aliases: ['audit'], purpose: 'Review an artifact.' },
  { owner: 'bridge', name: 'runtime-adaptation', visibility: 'support', aliases: ['bridge'], usedBy: ['audit'], when: 'When crossing runtimes.' },
] }; }


test('explicit invocation is a reviewed public-only catalog policy', () => {
  const c = contract(); c.entries[0].invocation = 'explicit';
  assert.equal(catalogExports(validateCatalog(c, ['audit', 'bridge']))[0].invocation, 'explicit');
  c.entries[1].invocation = 'explicit';
  assert.throws(() => validateCatalog(c, ['audit', 'bridge']), /invocation policy/);
});


test('explicit entry builds both host policies and rejects policy tampering', async t => {
  const box = mkdtempSync(join(tmpdir(), 'jstack-explicit-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const source = join(box, 'source'), output = join(box, 'package');
  mkdirSync(join(source, 'skills/sdlc'), { recursive: true });
  writeFileSync(join(source, 'skills/sdlc/SKILL.md'), '---\nname: sdlc\ndescription: Explicit SDLC only.\n---\nRead the scope before beginning.\n');
  writeJson(join(source, CATALOG_PATH), { schemaVersion: 1, categories: ['workflow'], entries: [{ owner: 'sdlc', name: 'sdlc', aliases: [], visibility: 'public', category: 'workflow', purpose: 'Explicit lifecycle.', invocation: 'explicit' }] });
  writeJson(join(source, 'packaging/product.json'), { name: 'jstack', version: '0.0.1', description: 'Explicit fixture', author: { name: 'jstack' }, skillCatalog: CATALOG_PATH });
  writeJson(join(source, 'packaging/package-files.json'), discoverMembership(source));
  await buildPackage(source, output);
  assert.match(readFileSync(join(output, 'entries/claude/workflow/sdlc/SKILL.md'), 'utf8'), /^disable-model-invocation: true$/m);
  const policy = join(output, 'entries/codex/workflow/sdlc/agents/openai.yaml');
  assert.match(readFileSync(policy, 'utf8'), /allow_implicit_invocation: false/);
  assert.deepEqual(jstackSurface(output).entries.filter(e => e.name === 'sdlc').map(e => e.disableModelInvocation), [true, true]);
  writeFileSync(policy, 'policy:\n  allow_implicit_invocation: true\n');
  assert.equal(jstackSurface(output).entries.find(e => e.host === 'codex')!.disableModelInvocation, undefined);
  const receipt = join(output, 'package-receipt.json'), value = JSON.parse(readFileSync(receipt, 'utf8'));
  value.files = digestFiles(output); writeJson(receipt, value);
  assert.throws(() => checkPackage(output), /invocation policy/);
  writeFileSync(policy, 'policy:\n  allow_implicit_invocation: false\n');
  const claude = join(output, 'entries/claude/workflow/sdlc/SKILL.md');
  writeFileSync(claude, readFileSync(claude, 'utf8').replace('disable-model-invocation: true', 'disable-model-invocation: false') + '\ndisable-model-invocation: true\n');
  value.files = digestFiles(output); writeJson(receipt, value);
  assert.throws(() => checkPackage(output), /invocation policy/, 'a body quotation cannot override native frontmatter');
});

test('SDLC generated and caller-owned path exclusions remain source-scoped', t => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-sdlc-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'contracts'));
  writeFileSync(join(root, 'contracts/sdlc.md'), '`/private/observed-user.json` and `/private/observed-environment.json`');
  writeFileSync(join(root, 'contracts/skill-catalog.md'), '`agents/openai.yaml`');
  assert.deepEqual(checkPluginPaths(root).misses, []);
  writeFileSync(join(root, 'contracts/sdlc.md'), '`/private/observed-wrong.json` and `scripts/missing.js`');
  writeFileSync(join(root, 'README.md'), '`agents/openai.yaml`');
  const misses = checkPluginPaths(root).misses;
  for (const name of ['/private/observed-wrong.json', 'scripts/missing.js', 'agents/openai.yaml']) assert.ok(misses.some(([ref]) => ref === name), name);
});
