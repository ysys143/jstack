/** Package builds from catalog sources: native compatibility aliases and the hierarchical source layout. */
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPackage, checkPackage, discoverMembership, writeJson } from './build.js';
import { CATALOG_PATH, authoredSkillPath, type SkillCatalog } from '../runtime/skill_catalog.js';
import { memoryTemporaryRoot } from '../runtime/fixtures/memory_tmp.js';
import { contract } from './catalog_fixture.js';

test('native compatibility entries resolve one host-selected body without copying the workflow', async t => {
  const box = mkdtempSync(join(memoryTemporaryRoot(), 'jstack-native-alias-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const source = join(box, 'source'), output = join(box, 'package');
  const put = (path: string, body: string) => { mkdirSync(join(source, path, '..'), { recursive: true }); writeFileSync(join(source, path), body); };
  const catalog: SkillCatalog = { schemaVersion: 1, categories: ['engineering'], entries: [{ owner: 'author', name: 'skill-creator', visibility: 'public', category: 'engineering', purpose: 'Author skills.', aliases: ['author', 'skill-authoring'], nativeAliases: ['author'] }] };
  put('skills/author/SKILL.md', '---\nname: author\ndescription: Create and improve skills.\n---\n\nCommon authoring behavior.\n');
  put('hosts/codex/skills/author/SKILL.md', '---\nname: author\ndescription: Create and improve skills in Codex.\n---\n\nCodex-specific authoring behavior.\n');
  writeJson(join(source, CATALOG_PATH), catalog);
  writeJson(join(source, 'packaging/product.json'), { name: 'jstack', version: '0.0.1', description: 'Alias fixture', author: {name: 'jstack'}, skillCatalog: CATALOG_PATH });
  writeJson(join(source, 'packaging/package-files.json'), discoverMembership(source));
  await buildPackage(source, output); rmSync(source, { recursive: true });
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'package-receipt.json'), 'utf8')).publicSkills, ['author', 'skill-creator']);
  for (const host of ['claude', 'codex']) {
    const body = readFileSync(join(output, `entries/${host}/engineering/author/SKILL.md`), 'utf8');
    assert.match(body, /^name: author$/m); assert.match(body, /disable-model-invocation: true/);
    assert.match(body, /Preserve all arguments and constraints/);
    assert.ok(body.includes(`payload/skills/author/${host === 'codex' ? 'SKILL.codex.md' : 'SKILL.md'}`));
    assert.doesNotMatch(body, /Common authoring behavior|Codex-specific authoring behavior/);
    assert.ok(existsSync(join(output, `entries/${host}/engineering/skill-creator/SKILL.md`)));
  }
  assert.equal(checkPackage(output).passed, true);
});

test('hierarchical source maps to one stable payload without compatibility source links', async t => {
  const box = realpathSync(mkdtempSync(join(memoryTemporaryRoot(), 'jstack-source-layout-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const source = join(box, 'source'), output = join(box, 'package');
  const catalog = contract(); catalog.sourceLayout = 'hierarchical';
  for (const entry of catalog.entries) {
    const dir = join(source, authoredSkillPath(entry)); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${entry.name}\ndescription: Migration fixture\n---\nPreserved ${entry.owner} behavior.\n`);
  }
  const support = join(source, authoredSkillPath(catalog.entries[1]));
  writeFileSync(join(support, 'data.txt'), 'preserved resource');
  writeFileSync(join(support, 'read.ts'), "import {readFileSync} from 'node:fs'; export const read=()=>readFileSync(new URL('./data.txt',import.meta.url),'utf8');\n");
  const workflow = join(source, authoredSkillPath(catalog.entries[0]));
  const sourceSkill = readFileSync(join(workflow, 'SKILL.md'));
  const blob = (body: Buffer) => createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  mkdirSync(join(workflow, 'tests/refs'), { recursive: true });
  writeFileSync(join(workflow, 'tests/refs/SKILL.md.lines'), `# blob:${blob(sourceSkill)}\nPreserved audit behavior.`);
  writeFileSync(join(workflow, 'main.ts'), "export { read } from '../../../support/runtime-adaptation/read.js';\n");
  mkdirSync(join(source, 'runtime')); writeFileSync(join(source, 'runtime/profiles.ts'), 'export const present=true;');
  writeJson(join(source, CATALOG_PATH), catalog);
  writeJson(join(source, 'packaging/product.json'), {name:'jstack',version:'0.0.1',description:'Hierarchy',author:{name:'jstack'},skillCatalog:CATALOG_PATH});
  const membership = discoverMembership(source);
  assert.ok(membership.files.some(row => row.source === 'skills/support/runtime-adaptation/data.txt' && row.target === 'skills/bridge/data.txt'));
  writeJson(join(source, 'packaging/package-files.json'), membership);
  await buildPackage(source, output);
  rmSync(source, { recursive: true });
  const run = spawnSync(process.execPath, ['--input-type=module','-e',`import {read} from ${JSON.stringify('file://' + join(output, 'payload/skills/audit/main.js'))}; console.log(read());`], {encoding:'utf8',cwd:box});
  assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout.trim(), 'preserved resource');
  assert.equal(existsSync(join(output, 'payload/skills/public')), false);
  assert.equal(checkPackage(output).passed, true);
  assert.match(readFileSync(join(output, 'payload/skills/audit/SKILL.md'), 'utf8'), /^name: audit$/m);
  assert.equal(readFileSync(join(output, 'payload/skills/audit/tests/refs/SKILL.md.lines'), 'utf8'), `# blob:${blob(readFileSync(join(output, 'payload/skills/audit/SKILL.md')))}\nPreserved audit behavior.`);
  assert.match(readFileSync(join(output, 'entries/codex/workflow/review/SKILL.md'), 'utf8'), /^name: review$/m);
});
