/** Spawned `jst disk` CLI processes that need no SQLite history. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { paths } from '../scripts/storage.js';
import { fixture } from './_fixtures.js';

test('CLI reports errors and help without touching user homes', () => {
  const root = fixture(), cli = fileURLToPath(new URL('../scripts/main.js', import.meta.url));
  try {
    const result = spawnSync(process.execPath, [cli, 'history', '--root', root], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /No history/); assert.equal(existsSync(paths(root).state), false);
    assert.equal(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).status, 0);
  } finally { rmSync(root, { recursive: true }); }
});
test('CLI context reads the memory another process recorded', async () => {
  const { remember } = await import('../scripts/memory.js');
  const root = fixture(), cli = fileURLToPath(new URL('../scripts/main.js', import.meta.url));
  try {
    const first = await remember(root, { kind: 'decision', scope: 'fixture volumes', summary: 'Keep selected volumes', evidence: 'fixture user selection' });
    await remember(root, { kind: 'decision', scope: 'fixture volumes', summary: 'Keep remaining volumes', evidence: 'fixture revised selection', supersedes: first.id });
    const run = spawnSync(process.execPath, [cli, 'context', '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const restored = JSON.parse(run.stdout);
    assert.equal(restored.memory.totalNotes, 2);
    assert.equal(restored.memory.decisions.length, 1);
    assert.match(restored.memory.guidance, /not permission/);
  } finally { rmSync(root, { recursive: true }); }
});
test('history without a new database points at a detected legacy database', { skip: process.platform === 'win32' ? 'HOME does not select the Windows home' : false }, () => {
  const home = fixture(), cli = fileURLToPath(new URL('../scripts/main.js', import.meta.url)), legacy = join(home, '.disk_cache/disk_history.db');
  mkdirSync(dirname(legacy)); writeFileSync(legacy, '');
  try {
    const result = spawnSync(process.execPath, [cli, 'history'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(result.status, 1); assert.match(result.stderr, /No history/); assert.match(result.stderr, /import-legacy/);
    assert.ok(result.stderr.includes(legacy), result.stderr); assert.equal(existsSync(join(home, '.jstack')), false);
  } finally { rmSync(home, { recursive: true }); }
});
