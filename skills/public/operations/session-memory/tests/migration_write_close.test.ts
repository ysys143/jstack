import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { write } from '../scripts/session_migration/common.js';

test('a failed close of the migration write descriptor is not retried', async t => {
  // A retried close can release a descriptor number another open has already reused.
  const { syncBuiltinESMExports } = await import('node:module');
  const fs = (await import('node:fs')).default; const original = fs.closeSync;
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-migration-close-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const closes: number[] = [];
  fs.closeSync = (fd: number) => { closes.push(fd); original(fd); throw Object.assign(new Error('injected close failure'), { code: 'EIO' }); };
  syncBuiltinESMExports();
  try { assert.throws(() => write(join(root, 'file'), Buffer.from('data')), /injected close failure/); }
  finally { fs.closeSync = original; syncBuiltinESMExports(); }
  assert.equal(closes.length, 1); assert.equal(existsSync(join(root, 'file')), false);
});
