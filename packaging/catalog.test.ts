import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPackage, transformFrozenReference, checkPackage, digestFiles, discoverMembership, writeJson } from './build.js';
import { CATALOG_PATH, authoredSkillPath, catalogExports, loadCatalog, resolveSkill, sourcePath, validateCatalog, type SkillCatalog } from '../runtime/skill_catalog.js';
import { checkCost, toks } from '../scripts/check_cost.js';
import { memoryTemporaryRoot } from '../runtime/fixtures/memory_tmp.js';
import { contract } from './catalog_fixture.js';

// Each package build loads the compiler and bundles the vendored libraries; the native-alias and hierarchical-layout
// builds are in catalog_layout.test.ts so that neither file carries all three builds.
test('catalog rejects ambiguous names, lost owners, path injection and dangling support', () => {
  const owners = ['audit', 'bridge'];
  assert.equal(validateCatalog(contract(), owners).entries.length, 2);
  for (const mutate of [
    (c: SkillCatalog) => { c.entries[1].aliases.push('review'); },
    (c: SkillCatalog) => { c.entries.pop(); },
    (c: SkillCatalog) => { c.entries[0].category = '../escape'; },
    (c: SkillCatalog) => { c.entries[0].name = '../escape'; },
    (c: SkillCatalog) => { c.entries[0].aliases = []; },
    (c: SkillCatalog) => { c.entries[0].nativeAliases = ['unknown']; },
    (c: SkillCatalog) => { c.entries[0].nativeAliases = ['audit', 'audit']; },
    (c: SkillCatalog) => { c.entries[1].nativeAliases = ['bridge']; },
    (c: SkillCatalog) => { c.entries[1].usedBy = ['absent']; },
    (c: SkillCatalog) => { c.entries[1].usedBy = ['bridge']; },
    (c: SkillCatalog) => { c.entries.push({ ...c.entries[0], name: 'another', aliases: [] }); },
  ]) { const changed = contract(); mutate(changed); assert.throws(() => validateCatalog(changed, owners)); }
  assert.throws(() => validateCatalog(contract(), [...owners, 'unclassified']));
  assert.deepEqual(catalogExports(contract()), [{ owner: 'audit', name: 'review', path: 'workflow/review' }]);
  assert.equal(resolveSkill(contract(), '$jstack:audit').invocation, 'jstack:review');
  assert.equal(resolveSkill(contract(), 'bridge').invocation, null);
  assert.throws(() => resolveSkill(contract(), 'unknown'));
});

test('catalog build preserves support and host bodies while exporting only nested public entries', async t => {
  const box = mkdtempSync(join(memoryTemporaryRoot(), 'jstack-catalog-test-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const source = join(box, 'source'), output = join(box, 'package');
  const put = (path: string, text: string) => { mkdirSync(join(source, path, '..'), { recursive: true }); writeFileSync(join(source, path), text); };
  for (const owner of ['audit', 'bridge']) put(`skills/${owner}/SKILL.md`, `---\nname: ${owner}\ndescription: >-\n  A long enough ${owner} description\n  that continues on the next line.\n---\n\nPreserve ${owner} procedure and relative references/example.md.\n`);
  put('skills/bridge/references/example.md', 'Shared support resource.');
  put('hosts/codex/skills/bridge/SKILL.md', '---\nname: bridge\ndescription: Codex support\n---\nUse native Codex tools.\n');
  put('hosts/claude/commands/old-command.md', '---\ndescription: Existing command\n---\nKeep this command.\n');
  put('runtime/profiles.ts', 'export const present = true;\n');
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  for (const name of ['skill_catalog.ts', 'catalog_cli.ts', 'entry.ts']) cpSync(join(repo, 'runtime', name), join(source, 'runtime', name));
  writeJson(join(source, CATALOG_PATH), contract());
  writeJson(join(source, 'packaging/product.json'), { name: 'jstack', version: '0.0.1', description: 'Catalog test', author: { name: 'jstack' }, skillCatalog: CATALOG_PATH });
  writeJson(join(source, 'packaging/package-files.json'), discoverMembership(source));
  await buildPackage(source, output);
  rmSync(source, { recursive: true });
  assert.equal(checkPackage(output).publicSkills, 1);
  const manifest = JSON.parse(readFileSync(join(output, '.claude-plugin/plugin.json'), 'utf8'));
  assert.deepEqual(manifest.skills, ['./entries/claude/workflow/review']);
  assert.equal(JSON.parse(readFileSync(join(output, '.codex-plugin/plugin.json'), 'utf8')).skills, './entries/codex');
  assert.equal(readFileSync(join(output, 'hosts/claude/commands/old-command.md'), 'utf8').includes('Keep this command.'), true);
  assert.equal(readFileSync(join(output, 'payload/skills/bridge/references/example.md'), 'utf8'), 'Shared support resource.');
  for (const host of ['claude', 'codex']) {
    const entry = join(output, `entries/${host}/workflow/review`);
    const body = readFileSync(join(entry, 'SKILL.md'), 'utf8');
    assert.match(body, /^name: review$/m);
    assert.match(body, /Preserve audit procedure and relative references\/example.md\./);
    assert.ok(body.includes(`payload/skills/bridge/${host === 'codex' ? 'SKILL.codex.md' : 'SKILL.md'}`));
    assert.equal(existsSync(join(output, `entries/${host}/support`)), false);
    assert.equal(existsSync(join(output, `entries/${host}/bridge`)), false);
    const out = spawnSync(process.execPath, [join(entry, 'scripts/inspect-root.mjs')], { encoding: 'utf8', cwd: box });
    assert.equal(out.status, 0, out.stderr);
    const marker = JSON.parse(out.stdout);
    assert.equal(realpathSync(marker.root), realpathSync(output));
    assert.equal(marker.skill, 'review');
    assert.equal(marker.sourcePresent, true);
    assert.equal(marker.runtimePresent, true);
    const lookup = spawnSync(process.execPath, [join(output, 'payload/runtime/catalog_cli.js'), 'resolve', 'bridge', '--host', host], { encoding: 'utf8', cwd: box });
    assert.equal(lookup.status, 0, lookup.stderr);
    assert.equal(JSON.parse(lookup.stdout).invocation, null);
    assert.equal(JSON.parse(lookup.stdout).body, `skills/bridge/${host === 'codex' ? 'SKILL.codex.md' : 'SKILL.md'}`);
  }
  const measured = checkCost(output);
  assert.ok(measured.count >= 1);
  assert.ok(measured.out.jstack.always_on_tokens >= toks('>-\n  A long enough audit description\n  that continues on the next line.'));
  // Even rewriting the byte receipt cannot legitimize an extra discoverable support skill.
  cpSync(join(output, 'payload/skills/bridge'), join(output, 'entries/codex/bridge'), { recursive: true });
  const receiptPath = join(output, 'package-receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.files = digestFiles(output); writeJson(receiptPath, receipt);
  assert.throws(() => checkPackage(output), /publication surface/);
});

test('current catalog classifies the complete source set and preserves meaningful legacy identities', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const catalog = loadCatalog(root)!;
  assert.ok(catalog);
  assert.equal(resolveSkill(catalog, 'humanize').name, 'humanize');
  assert.equal(resolveSkill(catalog, 'agent-maintenance').name, 'agent-maintenance');
  assert.notEqual(resolveSkill(catalog, 'image').name, resolveSkill(catalog, 'diagram').name);
  for (const entry of catalog.entries) assert.equal(resolveSkill(catalog, entry.owner).owner, entry.owner);
  for (const entry of catalog.entries) {
    assert.equal(sourcePath(root, `skills/${entry.owner}`), join(root, authoredSkillPath(entry)));
    assert.equal(existsSync(join(root, `skills/${entry.owner}/SKILL.md`)), false);
  }
});

test('payload transformations preserve reviewed frozen provenance without approving stale or altered references', () => {
  const source = Buffer.from('---\nname: review\n---\n\nKeep this rule.\n');
  const payload = Buffer.from(source.toString().replace('name: review', 'name: audit'));
  const blob = (body: Buffer) => createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  const frozen = `# blob:${blob(source)}\nKeep this rule.`;
  assert.equal(transformFrozenReference(frozen, source, payload, true), `# blob:${blob(payload)}\nKeep this rule.`);
  for (const bad of [frozen.replace(blob(source), '0'.repeat(40)), frozen.replace('Keep', 'Drop')]) {
    assert.equal(transformFrozenReference(bad, source, payload, true), bad);
  }
  assert.equal(transformFrozenReference(frozen, source, source, true), frozen);
});
