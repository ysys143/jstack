import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { inspect } from '../scripts/check_cjk_font.js';
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])));
test('Korean OOXML requires explicit East Asian fonts and honors the requested family', () => {
  const missing = zip({ 'ppt/slides/slide1.xml': '<a:t>한글</a:t>' });
  assert.equal(inspect(missing).code, 1);
  const document = zip({ 'word/document.xml': '<w:rFonts w:eastAsia="Pretendard"/><w:t xml:space="preserve">한글</w:t>' });
  assert.equal(inspect(document, 'pretendard').code, 0);
  assert.equal(inspect(document, 'Missing Family').code, 1);
  assert.equal(inspect(zip({ 'ppt/slides/slide1.xml': '<a:t>English</a:t>' })).code, 0);
  assert.throws(() => inspect(Buffer.from('not a zip')));
});
test('Python oracle agrees on archive scopes, font assignments and exact CLI output', { skip: process.env.JSTACK_ORACLE !== '1' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-cjk-font-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'artifact.pptx');
  const source = fileURLToPath(new URL('../../../../../../skills/public/artifacts/office-documents/scripts/check_cjk_font.py', import.meta.url));
  const cases: Record<string, string>[] = [
    { 'ppt/slides/slide1.xml': '<a:t>한글</a:t>' },
    { 'ppt/slides/slide1.xml': '<a:t>한글</a:t><a:ea typeface="Pretendard"/>' },
    { 'word/document.xml': '<w:t>한글</w:t><w:rFonts w:eastAsia="한글서체"/>' },
    { 'ppt/notesSlides/notesSlide1.xml': '<a:t>한글</a:t>' },
  ];
  for (const files of cases) {
    writeFileSync(file, zip(files));
    for (const args of [[], ['--require-font', 'Pretendard']]) {
      const py = spawnSync('python3', [source, file, ...args], { encoding: 'utf8' });
      const js = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check_cjk_font.js', import.meta.url)), file, ...args], { encoding: 'utf8' });
      assert.equal(js.status, py.status); assert.equal(js.stdout, py.stdout); assert.equal(js.stderr, py.stderr);
    }
  }
});
