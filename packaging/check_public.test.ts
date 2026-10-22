import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectPublic, REVIEWED_FIXTURES } from './check_public.js';

const PREFIX = 'skills/journey-qa/repos/journey-qa/';
// Compiled to dist/packaging, so the repository root is two levels up.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'skills/public/workflow/journey-qa/repos/journey-qa');
const PINNED = [...REVIEWED_FIXTURES.keys()][0]!.slice(PREFIX.length);
const credentialShaped = (dir: string) => inspectPublic(dir).findings.filter(item => item.kind === 'credential-shaped value').map(item => item.path);

function place(root: string, rel: string, from = PINNED): string {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(SOURCE, from), target);
  return target;
}

test('a pinned synthetic fixture passes only at its package path with its exact content', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-public-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pinned = place(root, PREFIX + PINNED);
  assert.deepEqual(credentialShaped(root), [], 'the reviewed fixture is accepted');

  appendFileSync(pinned, 'x');
  assert.deepEqual(credentialShaped(root), [PREFIX + PINNED], 'a changed byte is flagged again');

  rmSync(join(root, 'skills'), { recursive: true, force: true });
  place(root, 'skills/other/' + PINNED);
  assert.deepEqual(credentialShaped(root), ['skills/other/' + PINNED], 'the same content at another path is flagged');
});

test('a package root with a payload prefix resolves the same pinned path, and other credentials stay flagged', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-public-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  place(root, 'payload/' + PREFIX + PINNED);
  const stray = join(root, 'payload', 'skills', 'journey-qa', 'notes.txt');
  writeFileSync(stray, 'token ' + 'ghp_' + 'A'.repeat(30) + '\n');
  assert.deepEqual(credentialShaped(root), ['payload/skills/journey-qa/notes.txt']);
});

test('the marketplace root of a release resolves the same pinned path', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-public-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  place(root, 'plugins/jstack/payload/' + PREFIX + PINNED);
  assert.deepEqual(credentialShaped(root), []);
  place(root, 'plugins/other/payload/' + PREFIX + PINNED);
  assert.deepEqual(credentialShaped(root), ['plugins/other/payload/' + PREFIX + PINNED], 'only the jstack plugin path is accepted');
});

test('every reviewed fixture still exists in the vendored copy with its pinned hash', () => {
  // Keys are package paths; the reviewed membership maps each one back to its source file.
  const sources = new Map((JSON.parse(readFileSync(join(ROOT, 'packaging/package-files.json'), 'utf8')).files as { source: string; target: string }[]).map(row => [row.target, row.source]));
  for (const [key, hash] of REVIEWED_FIXTURES) {
    const source = sources.get(key);
    assert.ok(source, `${key} is not a package member`);
    assert.equal(createHash('sha256').update(readFileSync(join(ROOT, source))).digest('hex'), hash, key);
  }
});
