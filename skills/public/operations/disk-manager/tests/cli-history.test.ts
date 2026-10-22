/** Spawned `jst disk` diff and history CLI processes reading a SQLite history. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openHistory, record } from '../scripts/history.js';
import { fixture, native, sample, seedNative } from './_fixtures.js';

test('diff and history name a legacy database that a jstack history has not imported', { skip: process.platform === 'win32' ? 'HOME does not select the Windows home' : false }, async () => {
  const home = fixture(), cli = fileURLToPath(new URL('../scripts/main.js', import.meta.url)), legacy = join(home, '.disk_cache/disk_history.db');
  mkdirSync(dirname(legacy)); writeFileSync(legacy, '');
  try {
    const db = await openHistory(join(home, '.jstack'), true, native); await record(db, [sample(100, 40)], null, 90, 100); await db.close(); seedNative(join(home, '.jstack'));
    for (const action of ['diff', 'history']) {
      const result = spawnSync(process.execPath, [cli, action, '--json'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
      assert.equal(result.status, 0, result.stderr); JSON.parse(result.stdout);
      assert.ok(result.stderr.includes(legacy), result.stderr); assert.match(result.stderr, /import-legacy/);
    }
  } finally { rmSync(home, { recursive: true }); }
});
