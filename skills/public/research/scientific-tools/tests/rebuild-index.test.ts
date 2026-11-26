import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { GENERATED_MARKER, HEAD_ROW, rebuild, replace_table, skill_files } from '../scripts/rebuild-index.js';
const catalog = '## Biology\n- **[Alpha](../skills/alpha/)**\n';
const put = (root: string, file: string, text: string) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'jstack-science-index-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'references/_sources.json', JSON.stringify({ kdense: { repo: 'catalog', url: 'https://example.com', commit: 'abcdef1234', license: 'MIT — notes' } }));
  put(root, 'repos/kdense/alpha/SKILL.md', '---\nname: alpha\ndescription: "한글 😀. A second sentence."\n---\nBody\n');
  put(root, 'SKILL.md', '# Science\n\n' + HEAD_ROW + '| `old.md` | 1 | Old |\n\nPreserve prose.\n\n| User table |\n|---|\n| retained |\n');
  return root;
}
test('science regeneration preserves user prose/references and skips directory aliases', t => {
  const root = fixture(t);
  put(root, 'references/user.md', '# User reference\n');
  put(root, 'references/old-generated.md', GENERATED_MARKER + '\nold');
  if (process.platform !== 'win32') symlinkSync('alpha', join(root, 'repos/kdense/alias'));
  assert.equal(skill_files(join(root, 'repos/kdense')).length, 1);
  const result = rebuild(root, catalog);
  assert.equal(result.skills, 1); assert.equal(result.domains, 1);
  assert.equal(readFileSync(join(root, 'references/user.md'), 'utf8'), '# User reference\n');
  assert.equal(existsSync(join(root, 'references/old-generated.md')), false);
  assert.match(readFileSync(join(root, 'SKILL.md'), 'utf8'), /Preserve prose\.[\s\S]*retained/);
});
test('routing marker errors and unowned output collisions fail before deletion', t => {
  const root = fixture(t); put(root, 'references/biology.md', '# User document'); put(root, 'references/old.md', '<!-- sources -->');
  assert.throws(() => rebuild(root, catalog), /Unowned reference/);
  assert.ok(existsSync(join(root, 'references/old.md')));
  put(root, 'SKILL.md', '# No marker');
  assert.throws(() => rebuild(root, catalog), /marker/);
});
test('output symlinks cannot redirect generated writes', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t), destination = join(root, 'outside.md');
  symlinkSync(destination, join(root, 'references/biology.md'));
  assert.throws(() => rebuild(root, catalog), /regular file/);
  assert.equal(existsSync(destination), false);
});

test('legacy indexed domains migrate and update while source-only references survive', t => {
  const root = fixture(t);
  const manual = ['stats-corrections.md', 'reproducibility.md', 'tier-a-verdicts.md'];
  // Tests run from dist; the authoritative documents remain in the source tree.
  const referenceRoot = join(process.cwd(), 'skills/public/research/scientific-tools/references');
  for (const file of manual) cpSync(join(referenceRoot, file), join(root, 'references', file));
  put(root, 'references/unknown.md', '<!-- sources -->\nUnindexed reference');
  put(root, 'references/_index.json', JSON.stringify([
    { file: 'biology.md', domain: 'Biology', count: 1 },
    { file: 'retired.md', domain: 'Retired', count: 1 },
  ]));
  const legacy = (domain: string) => `# ${domain}\n\n<!-- sources -->\ncredits\n\n1 skills. Choose one, read SKILL.md at its \`path\`, and follow its instructions.\n`;
  put(root, 'references/biology.md', legacy('Biology'));
  put(root, 'references/retired.md', legacy('Retired'));
  const before = manual.map(file => readFileSync(join(root, 'references', file)));
  rebuild(root, catalog);
  manual.forEach((file, i) => assert.deepEqual(readFileSync(join(root, 'references', file)), before[i]));
  assert.ok(existsSync(join(root, 'references/unknown.md')));
  assert.equal(existsSync(join(root, 'references/retired.md')), false);
  assert.ok(readFileSync(join(root, 'references/biology.md'), 'utf8').startsWith(GENERATED_MARKER));
  put(root, 'repos/kdense/alpha/SKILL.md', '---\nname: alpha\ndescription: Updated description.\n---\n');
  rebuild(root, catalog);
  assert.match(readFileSync(join(root, 'references/biology.md'), 'utf8'), /Updated description/);
  const snapshot = () => Object.fromEntries(['SKILL.md', ...readdirSync(join(root, 'references')).map(file => 'references/' + file)].map(file => [file, { content: readFileSync(join(root, file), 'utf8'), mtime: statSync(join(root, file)).mtimeMs }]));
  const once = snapshot();
  rebuild(root, catalog);
  assert.deepEqual(snapshot(), once);
});
test('source metadata does not permit overwriting an active domain', t => {
  const root = fixture(t);
  put(root, 'references/biology.md', '# Biology\n\n<!-- sources -->\nHandwritten.');
  assert.throws(() => rebuild(root, catalog), /Unowned reference/);
  assert.match(readFileSync(join(root, 'references/biology.md'), 'utf8'), /Handwritten/);
});
test('complete checked-in routing regenerates twice without changing authored documents', t => {
  const root = fixture(t);
  const sourceRoot = join(process.cwd(), 'skills/public/research/scientific-tools');
  cpSync(join(sourceRoot, 'references'), join(root, 'references'), { recursive: true });
  cpSync(join(sourceRoot, 'SKILL.md'), join(root, 'SKILL.md'));
  rmSync(join(root, 'repos'), { recursive: true });
  cpSync(join(sourceRoot, 'repos'), join(root, 'repos'), { recursive: true, verbatimSymlinks: true });
  const snapshot = () => Object.fromEntries(['SKILL.md', ...readdirSync(join(root, 'references')).map(file => 'references/' + file)].map(file => [file, readFileSync(join(root, file), 'utf8')]));
  const before = snapshot();
  const localCatalog = before['references/_kdense-catalog.md'];
  const result = rebuild(root, localCatalog);
  const once = snapshot();
  const oldIndex = JSON.parse(before['references/_index.json']);
  assert.deepEqual(result.index.map(({ domain, file, count }) => ({ domain, file, count })), oldIndex.map(({ domain, file, count }: { domain: string; file: string; count: number }) => ({ domain, file, count })));
  for (const file of ['stats-corrections.md', 'reproducibility.md', 'tier-a-verdicts.md']) assert.equal(once['references/' + file], before['references/' + file]);
  assert.equal(once['SKILL.md'], before['SKILL.md']);
  assert.deepEqual(Object.keys(once), Object.keys(before));
  rebuild(root, localCatalog);
  assert.deepEqual(snapshot(), once);
});

test('empty routing tables remain stable across repeated replacement', () => {
  const text = HEAD_ROW + '| `old.md` | 1 | Old |\n\nPreserved prose.\n';
  const once = replace_table(text, '');
  assert.equal(once, HEAD_ROW + '\nPreserved prose.\n');
  assert.equal(replace_table(once, ''), once);
});
