/** Typed evidence needs across a process boundary: FIFO inputs run in a child with a hard timeout, and a spawned CLI keeps the exit codes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../../../../../runtime/os.js';
import { LIMITS } from '../scripts/evidence_needs.js';
import { cli, COVERAGE, fixture, kinds, sha } from './_fixtures.js';

test('inputs are read within fixed bounds and a FIFO cannot hang the checker', async t => {
  const f = fixture(t);
  f.put('big.log', 'x'.repeat(LIMITS.fileBytes + 1));
  const big = await f.run(m => { m.sources.S2 = { path: 'big.log', sha256: sha('x'.repeat(LIMITS.fileBytes + 1)) }; m.needs[0].items[0].source = 'S2'; });
  assert.ok(kinds(big).includes('SOURCE_MISSING') && /larger than/.test(JSON.stringify(big.json)));
  if (process.platform !== 'win32') {
    const fifo = join(f.root, 'pipe.log'); assert.equal(runProcess('mkfifo', [fifo]).status, 0);
    // A blocking open cannot be interrupted in-process, so FIFO inputs run in a child with a hard timeout.
    const child = (extra: string[]) => runProcess(process.execPath, [COVERAGE, '--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--format', 'json', ...extra], { timeout: 20000 });
    const timedOut = (r: { error?: Error }): boolean => (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    const piped = f.base(); piped.sources.S3 = { path: 'pipe.log', sha256: sha('') }; piped.needs[0].items[0].source = 'S3'; writeFileSync(f.needsPath, JSON.stringify(piped));
    const fromSource = child(['--report', join(f.root, 'report.md')]);
    assert.ok(!timedOut(fromSource), 'a FIFO source blocked the checker'); assert.equal(fromSource.status, 1); assert.match(fromSource.stdout, /SOURCE_MISSING/);
    const asReport = child(['--report', fifo]);
    assert.ok(!timedOut(asReport), 'a FIFO report blocked the checker'); assert.equal(asReport.status, 2);
    writeFileSync(f.needsPath, JSON.stringify(f.base()));
    symlinkSync(join(f.root, 'incidents.log'), join(f.root, 'alias.log'));
    const aliased = await f.run(m => { m.sources.S4 = { path: 'alias.log', sha256: m.sources.S1.sha256 }; m.needs[0].items[0].source = 'S4'; });
    assert.ok(kinds(aliased).includes('SOURCE_MISSING'), 'a symbolic link is not followed');
  }
  assert.equal((await cli(['--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'big.log')])).code, 2, 'an oversized report is refused in typed mode');
  const many = fixture(t); const tooMany = await many.run(m => { for (let i = 0; i < LIMITS.sources + 1; i++) m.sources[`X${i}`] = m.sources.S1; });
  assert.equal(tooMany.code, 2);
});
test('a spawned process runs the same opt-in path and exit codes', t => {
  const f = fixture(t); const m = f.base(); writeFileSync(f.needsPath, JSON.stringify(m));
  const args = [COVERAGE, '--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md')];
  const ok = runProcess(process.execPath, args);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /mechanical result: consistent/);
  m.needs[2].claimed = '1'; writeFileSync(f.needsPath, JSON.stringify(m));
  const bad = runProcess(process.execPath, args); assert.equal(bad.status, 1); assert.match(bad.stdout, /\[ARITHMETIC_MISMATCH\]/);
  const abort = runProcess(process.execPath, [COVERAGE, '--needs', join(f.root, 'absent.json'), '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md')]);
  assert.equal(abort.status, 2);
});
