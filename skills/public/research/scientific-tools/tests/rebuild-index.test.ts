import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { HEAD_ROW, rebuild, skill_files } from '../scripts/rebuild-index.js';
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
  put(root, 'references/old-generated.md', '<!-- sources -->\nold');
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
