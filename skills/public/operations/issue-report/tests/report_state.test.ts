import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { atomicWrite } from '../../../../../runtime/os.js';
import { DEFAULT_REPO, EXCERPT_LIMIT, ensure, readConfig, readQueue, roots } from '../scripts/state.js';
import { cli, fixture, GH_TOKEN, ghCalls, LONG_FAILURE, transcripts, wholeWordPrefix } from './_report_helpers.js';

test('scan queues redacted candidates and deduplicates against the queue and receipts', async () => {
  const home = fixture();
  try {
    transcripts(home);
    const first = await cli(home, ['scan', '--json']);
    assert.equal(first.code, 0, first.err);
    const result = JSON.parse(first.out);
    assert.equal(result.complete, true); assert.equal(result.added.length, 3);
    const queue = readQueue(roots(home));
    assert.equal(queue.length, 3);
    for (const c of queue) {
      assert.equal(c.excerpt.includes(home), false); assert.equal(c.excerpt.includes(GH_TOKEN), false);
      assert.equal(c.excerpt.includes('someone@example.com'), false); assert.equal(c.excerpt.includes('abc.def-123'), false);
      assert.ok(c.excerpt.length <= EXCERPT_LIMIT + 20);
    }
    const again = JSON.parse((await cli(home, ['scan', '--json'])).out);
    assert.equal(again.added.length, 0); assert.equal(again.duplicates.length, 3);
    const receiptOnly = fixture();
    try {
      transcripts(receiptOnly);
      const r = roots(receiptOnly); mkdirSync(r.reports, { recursive: true, mode: 0o700 });
      writeFileSync(join(r.reports, 'receipts.jsonl'), queue.map(c => JSON.stringify({ id: c.id, url: 'https://example.invalid/1', submittedAt: '2026-01-01T00:00:00Z', signature: c.signature })).join('\n') + '\n', { mode: 0o600 });
      assert.equal(JSON.parse((await cli(receiptOnly, ['scan', '--json'])).out).added.length, 0);
    } finally { rmSync(receiptOnly, { recursive: true, force: true }); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a missing transcript source is a warning, never a clean result', async () => {
  const home = fixture();
  try {
    const text = await cli(home, ['scan']);
    assert.equal(text.code, 0);
    assert.match(text.out, /WARNING: claude transcripts are not available/);
    assert.match(text.out, /WARNING: codex transcripts are not available/);
    assert.match(text.out, /not a complete result/);
    assert.doesNotMatch(text.out, /No new jstack failures found in the window\./);
    assert.equal(JSON.parse((await cli(home, ['scan', '--json'])).out).complete, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('config holds only repo and lastRetro; notes, dismissal and the retrospective marker are local', async () => {
  const home = fixture();
  try {
    assert.equal((await cli(home, ['opt-in'])).code, 2); assert.equal((await cli(home, ['opt-out'])).code, 2);
    const r = roots(home); ensure(r);
    atomicWrite(join(r.reports, 'config.json'), Buffer.from(JSON.stringify({ optIn: true, repo: 'owner/repo', lastRetro: null })));
    assert.deepEqual(readConfig(r), { repo: 'owner/repo', lastRetro: null });
    const noted = await cli(home, ['note', '--surface', 'jst disk', '--text', `failed for ${home}/x`, '--json']);
    assert.equal(noted.code, 0, noted.err);
    const note = JSON.parse(noted.out);
    assert.equal(note.recorded, true); assert.equal(note.candidate.excerpt.includes(home), false);
    assert.equal(JSON.parse((await cli(home, ['note', '--surface', 'jst disk', '--text', 'failed for /other/y', '--json'])).out).recorded, false);
    assert.equal((await cli(home, ['dismiss', note.candidate.id])).code, 0);
    assert.equal(readQueue(roots(home))[0].status, 'dismissed');
    assert.equal(JSON.parse((await cli(home, ['list', '--json'])).out).length, 0);
    assert.equal((await cli(home, ['finish'])).code, 0);
    assert.match((await cli(home, ['status'])).out, /under 20 hours/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(r.reports, 'config.json'), 'utf8'))).sort(), ['lastRetro', 'repo']);
    assert.equal('optIn' in JSON.parse((await cli(home, ['status', '--json'])).out), false);
    assert.equal((await cli(home, ['dismiss', 'rpt-000000000000'])).code, 1);
    assert.equal(ghCalls(home).length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a long note surface and a long list headline end at a word boundary', async () => {
  const home = fixture();
  try {
    const surface = `jst disk ${'status word '.repeat(10)}`.trim(), flat = LONG_FAILURE.replace(/\s+/g, ' ');
    const noted = await cli(home, ['note', '--surface', surface, '--text', LONG_FAILURE, '--json']);
    assert.equal(noted.code, 0, noted.err);
    wholeWordPrefix(JSON.parse(noted.out).candidate.skillOrCommand, surface, 80);
    const listed = (await cli(home, ['list'])).out.trim();
    assert.equal(listed.split('\n').length, 1);
    wholeWordPrefix(listed.split('  ').at(-1)!, flat, 80);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a --repo that reads as an option is a usage error before any draft or gh call', async () => {
  const home = fixture();
  try {
    assert.equal((await cli(home, ['submit', 'rpt-000000000000', '--confirm', '--repo', '-b/x'])).code, 2);
    assert.equal(ghCalls(home).length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
