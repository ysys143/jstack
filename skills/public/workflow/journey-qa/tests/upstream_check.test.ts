import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runUpstreamCheck } from './_upstream_check.js';

const identity = { digest: 'pinned-tree', count: 405 };

test('upstream failure retains complete streams and input identity beyond the console tail', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-upstream-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stdout = 'MISMATCH internal assertion\n' + 'later successful control\n'.repeat(12), stderr = 'diagnostic on stderr\n';
  const file = join(dir, 'journey-qa.details.json');
  const result = runUpstreamCheck(dir, { JSTACK_SUITE_INPUT_FINGERPRINT: 'package-input', JSTACK_SUITE_RUN_ID: 'run-input' }, file, identity,
    () => ({ status: 1, signal: null, stdout, stderr }));
  assert.equal(result.status, 1);
  const evidence = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(evidence.stdout, stdout);
  assert.equal(evidence.stderr, stderr);
  assert.equal(evidence.stdoutSha256, createHash('sha256').update(stdout).digest('hex'));
  assert.equal(evidence.complete, true);
  assert.equal(evidence.exitCode, 1);
  assert.equal(evidence.inputFingerprint, 'package-input');
  assert.equal(evidence.runId, 'run-input');
  assert.deepEqual(evidence.upstream, identity);
});

test('timeout preserves partial output, signal, and execution error without claiming a complete log', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-upstream-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'journey-qa.details.json');
  runUpstreamCheck(dir, {}, file, identity, () => ({ status: null, signal: 'SIGTERM', stdout: 'partial', stderr: '', error: Object.assign(new Error('spawnSync bash ETIMEDOUT'), { code: 'ETIMEDOUT' }) }));
  const evidence = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(evidence.complete, false);
  assert.equal(evidence.exitCode, null);
  assert.equal(evidence.signal, 'SIGTERM');
  assert.equal(evidence.error.code, 'ETIMEDOUT');
  assert.equal(evidence.stdout, 'partial');
});
