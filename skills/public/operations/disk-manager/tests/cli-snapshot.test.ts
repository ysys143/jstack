/** The snapshot CLI with real du (macOS): exit status by completeness and measurements kept when recording fails. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { differences, openHistory } from '../scripts/history.js';
import { defaultProfile, paths } from '../scripts/storage.js';
import { fixture, native, seedNative } from './_fixtures.js';

test('snapshot writes isolated history and returns failure for an incomplete scan', { skip: process.platform !== 'darwin' }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const root = fixture(), cli = fileURLToPath(new URL('../scripts/main.js', import.meta.url));
  const data = join(root, 'data'), unreadable = join(root, 'locked'), mixed = join(root, 'mixed'), hidden = join(mixed, 'hidden'); mkdirSync(data); writeFileSync(join(data, 'file'), 'fixture'); mkdirSync(unreadable);
  mkdirSync(hidden, { recursive: true }); writeFileSync(join(mixed, 'file'), 'fixture');
  // The CLI runs once per exit status; the protected cases run the same snapshot with real du in process.
  const cases = [
    { name: 'complete', cli: true, categories: { fixture: data }, status: 0, complete: true, reason: null, partial: [] as string[] },
    { name: 'partial', cli: true, categories: { fixture: join(root, 'absent') }, status: 1, complete: false, reason: 'missing', partial: [] as string[] },
    // Root reads a 000 directory, so the protected cases need an unprivileged user.
    ...(process.getuid?.() === 0 ? [] : [
      { name: 'protected', cli: false, categories: { fixture: data, locked: unreadable }, status: 0, complete: false, reason: 'permission-denied', partial: [] as string[] },
      { name: 'partly-readable', cli: false, categories: { fixture: data, mixed }, status: 0, complete: false, reason: null, partial: ['mixed'] },
    ]),
  ];
  chmodSync(unreadable, 0); chmodSync(hidden, 0);
  try {
    for (const expected of cases) {
      const state = join(root, expected.name), p = { ...defaultProfile(root), filesystem: root, categories: expected.categories };
      let output: Record<string, any>;
      if (expected.cli) {
        mkdirSync(join(state, 'profiles'), { recursive: true, mode: 0o700 });
        writeFileSync(paths(state).profile, JSON.stringify(p), { mode: 0o600 }); seedNative(state);
        const run = spawnSync(process.execPath, [cli, 'snapshot', '--root', state, '--json'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(run.status, expected.status, run.stderr || run.stdout); output = JSON.parse(run.stdout);
      } else { output = await snapshot(state, p, undefined, { native }); assert.equal(output.exitCode, expected.status); }
      assert.equal(output.complete, expected.complete);
      assert.deepEqual(output.unmeasured.map((entry: Record<string, unknown>) => entry.reason), expected.reason ? [expected.reason] : []);
      assert.deepEqual(output.partial.map((entry: Record<string, unknown>) => entry.category), expected.partial);
      assert.equal(existsSync(paths(state).db), true);
      // The diff CLI is spawned by the history tests; here the recorded rows are compared in process.
      const db = await openHistory(state, false, native);
      try {
        assert.ok((await differences(db, 24)).every(row => row.deltaBytes === null));
        if (expected.name === 'protected') assert.deepEqual((await db.query("SELECT category, bytes FROM measurements WHERE error LIKE 'permission-denied:%'")).map(row => [row.category, row.bytes]), [['locked', null]]);
        if (expected.name === 'partly-readable') { const [row] = await db.query("SELECT category, bytes FROM measurements WHERE error LIKE 'partial-permission-denied:%'"); assert.equal(row.category, 'mixed'); assert.ok(Number(row.bytes) > 0); }
      } finally { await db.close(); }
    }
    // A snapshot that measured but could not record prints its measurements in the error output.
    const complete = join(root, 'complete'), db = await openHistory(complete, true, native);
    await db.exec("CREATE TRIGGER refuse BEFORE INSERT ON measurements BEGIN SELECT RAISE(ABORT, 'injected refusal'); END;"); await db.close();
    const refused = spawnSync(process.execPath, [cli, 'snapshot', '--root', complete, '--json'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(refused.status, 1, refused.stdout); const failure = JSON.parse(refused.stderr);
    assert.match(failure.error, /injected refusal.*fixture=\d+/); assert.equal(failure.unrecorded.samples[0].category, 'fixture'); assert.ok(failure.unrecorded.samples[0].bytes > 0);
  } finally { chmodSync(unreadable, 0o700); chmodSync(hidden, 0o700); rmSync(root, { recursive: true }); }
});
