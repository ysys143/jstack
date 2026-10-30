import assert from 'node:assert/strict';
import { test } from 'node:test';
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
