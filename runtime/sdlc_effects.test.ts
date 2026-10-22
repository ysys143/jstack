import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEffect } from './sdlc_effects.js';
function fixture(t: any) {
  const box = mkdtempSync(path.join(tmpdir(), 'jstack-effect-')), root = path.join(box, 'repo'); mkdirSync(root);
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  writeFileSync(path.join(root, 'app'), 'one'); git('add', 'app'); git('commit', '-qm', 'one');
  return { box, root, git };
}
test('real local Git remote readback distinguishes missing, present, moved and unavailable refs', t => {
  const f = fixture(t), remote = path.join(f.box, 'remote.git'); f.git('init', '--bare', remote); f.git('remote', 'add', 'fixture', remote);
  const target = { remote: 'fixture', branch: 'feature', head: f.git('rev-parse', 'HEAD') };
  assert.equal(readEffect(f.root, 'push', target).outcome, 'absent');
  f.git('push', '-q', 'fixture', 'HEAD:refs/heads/feature');
  assert.equal(readEffect(f.root, 'push', target).outcome, 'present');
  assert.equal(readEffect(f.root, 'push', { ...target, head: '0'.repeat(40) }).outcome, 'unknown');
  assert.equal(readEffect(f.root, 'push', { ...target, remote: path.join(f.box, 'missing') }).outcome, 'unknown');
});
test('commit response loss is reconciled against both parent and tree', t => {
  const f = fixture(t), parent = f.git('rev-parse', 'HEAD');
  writeFileSync(path.join(f.root, 'app'), 'two'); f.git('add', 'app'); const target = { parent, tree: f.git('write-tree') };
  assert.equal(readEffect(f.root, 'commit', target).outcome, 'absent'); f.git('commit', '-qm', 'two');
  assert.equal(readEffect(f.root, 'commit', target).outcome, 'present');
  assert.equal(readEffect(f.root, 'commit', { ...target, tree: '0'.repeat(40) }).outcome, 'unknown');
});
test('GitHub readback checks exact repository, branch, base, SHA and unambiguous provider response', t => {
  const f = fixture(t), target = { repository: 'owner/repo', branch: 'feature', base: 'main', head: f.git('rev-parse', 'HEAD') };
  const row = { number: 3, html_url: 'https://github.com/owner/repo/pull/3', state: 'open', head: { ref: 'feature', sha: target.head, repo: { full_name: target.repository } }, base: { ref: 'main', repo: { full_name: target.repository } } };
  const probe = (rows: unknown, ok = true) => readEffect(f.root, 'pr', target, endpoint => { assert.match(endpoint, /head=owner%3Afeature&base=main/); return { ok, output: JSON.stringify(rows) }; }).outcome;
  assert.equal(probe([row]), 'present'); assert.equal(probe([]), 'absent');
  assert.equal(probe([], false), 'unknown'); assert.equal(probe([row, row]), 'unknown');
  assert.equal(probe([{ ...row, head: { ...row.head, sha: '0'.repeat(40) } }]), 'unknown');
  assert.equal(probe([{ ...row, base: { ref: 'another', repo: row.base.repo } }]), 'unknown');
  assert.equal(probe([{ ...row, state: 'closed' }]), 'unknown');
  assert.equal(probe([{ ...row, head: { ...row.head, repo: { full_name: 'foreign/repo' } } }]), 'unknown');
  assert.equal(readEffect(f.root, 'pr', target, () => ({ ok: false, output: 'not-json' })).outcome, 'unknown');
});
