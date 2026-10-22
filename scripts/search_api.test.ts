import test from 'node:test';
import assert from 'node:assert/strict';
import { search, searchUrl, formatResponse } from './search_api.js';
test('search URL preserves literal Unicode and metacharacters without extra parameters', () => {
  const query = '한글 &limit=500 $(touch file)'; const url = searchUrl(['skills', query]);
  assert.equal(url.searchParams.get('q'), query); assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(searchUrl(['plugins', 'x']).pathname, '/api/search');
  for (const args of [[], ['else', 'x'], ['skills', 'x', '1&admin=1'], ['skills', 'x', '2', 'bad']]) assert.throws(() => searchUrl(args));
});
test('search formats all supported containers including arrays and raw fallback', () => {
  for (const value of [[{name: 'one'}], {skills: [{name: 'one'}]}, {plugins: [{name: 'one'}]}, {data: [{name: 'one'}]}, {results: [{name: 'one'}]}]) assert.match(formatResponse(JSON.stringify(value)), /Total: 1 results[\s\S]*Name: one/);
  assert.equal(formatResponse('not-json'), 'not-json'); assert.match(formatResponse('{}'), /Unexpected/);
});
test('search reports HTTP/empty failures and uses a bounded request without real network', async () => {
  assert.equal((await search(['skills', 'x'], (async () => new Response('', {status: 503})) as typeof fetch)).code, 1);
  assert.equal((await search(['skills', 'x'], (async () => new Response('')) as typeof fetch)).code, 1);
  const result = await search(['skills', 'x'], (async (_, options) => { assert.ok(options?.signal); return new Response('{"results":[],"total":0}'); }) as typeof fetch);
  assert.equal(result.code, 0); assert.match(result.text, /Total: 0/);
});
