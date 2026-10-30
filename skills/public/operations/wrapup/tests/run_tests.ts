/** Owning contracts for the shared local work-report core and its wrapup convenience surface. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { collectRecords, periodFor, writeBundle } from '../../../../../runtime/work_report.js';

const skillDirectory = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('the shared core provides daily, weekly, and arbitrary ranges', () => {
  assert.deepEqual(periodFor('daily', '2026-09-15'), { since: '2026-09-15', until: '2026-09-15' });
  assert.deepEqual(periodFor('weekly', '2026-09-15'), { since: '2026-09-14', until: '2026-09-20' });
  assert.deepEqual(periodFor('range', '2026-09-15', '2026-09-01', '2026-09-15'), { since: '2026-09-01', until: '2026-09-15' });
  assert.throws(() => periodFor('range', '2026-09-15', '2026-09-16', '2026-09-15'), /SINCE/);
});

test('the wrapup convenience surface delegates shared reporting behavior', () => {
  const skill = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');
  const corePath = [
    join(skillDirectory, '..', '..', 'runtime', 'WORK-REPORT.md'),
    join(skillDirectory, '..', '..', '..', '..', 'runtime', 'WORK-REPORT.md'),
  ].find(existsSync);
  assert.ok(corePath, 'shared work-report contract is present');
  const core = readFileSync(corePath, 'utf8');
  assert.match(skill, /편의 진입점 중 하나/);
  assert.match(skill, /어떤 작업도 `wrapup`을 거쳐야/);
  assert.match(skill, /얇은\s*진입점이다/);
  assert.match(skill, /두 명령은 절차를\s*되풀이하지 않는다/);
  assert.match(skill, /runtime\/work_report\.js/);
  assert.match(core, /A workflow may call\s+it/);
  assert.match(core, /Any selected workflow may call it directly/);
  assert.match(core, /not a public skill/);
});

test('the shared work-report core writes a private local bundle without gws or a collaboration target', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-wrapup-')));
  try {
    const projects = join(root, 'projects', 'plain');
    mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, 'README.md'), 'local work\n');
    const collection = collectRecords({ since: '2000-01-01', until: '2100-01-01' }, { projectsRoot: join(root, 'projects') });
    const result = writeBundle(collection, join(root, 'state'));
    assert.equal(result.records > 0, true);
    assert.equal(existsSync(join(root, 'state', 'evidence.jsonl')), true);
    assert.equal(existsSync(join(root, 'state', 'manifest.json')), true);
    assert.equal(existsSync(join(root, 'state', 'report.md')), true);
    assert.equal(existsSync(join(root, 'state', 'prompt.md')), true);
    assert.equal(statSync(join(root, 'state')).mode & 0o077, 0);
    const report = readFileSync(join(root, 'state', 'report.md'), 'utf8');
    assert.match(report, /Needs confirmation/);
    assert.doesNotMatch(report, /Google Drive|gws/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the shared work-report core keeps source failures as warnings instead of converting them to zero work', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-wrapup-missing-')));
  try {
    assert.throws(() => collectRecords({ since: '2026-09-15', until: '2026-09-15' }, { projectsRoot: join(root, 'missing') }), /Collection directory does not exist/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
