import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply, inspect } from '../scripts/project_portability.js';

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'jstack-project-portability-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  const write = (relative: string, body: string) => { const file = join(root, relative); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); };
  const commit = () => {
    assert.equal(spawnSync('git', ['-C', root, 'add', '.']).status, 0);
    assert.equal(spawnSync('git', ['-C', root, '-c', 'user.name=jstack Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']).status, 0);
  };
  return { root, write, commit };
}

test('applies lossless root and portable skill migration with relative Claude link', t => {
  const f = fixture(t); f.write('CLAUDE.md', '# Preserved rule\n'); f.write('.claude/skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo.\n---\nUse repository tools.\n'); f.commit();
  const before = inspect(f.root); assert.equal(before.eligible.instructions, 'promote-claude'); assert.deepEqual(before.eligible.skills, ['demo']);
  const result = apply(f.root); assert.deepEqual(result.applied, { instructions: 'promote-claude', skills: ['demo'] });
  assert.equal(readFileSync(join(f.root, 'AGENTS.md'), 'utf8'), '# Preserved rule\n'); assert.equal(readFileSync(join(f.root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(readlinkSync(join(f.root, '.claude/skills/demo')), join('..', '..', '.agents', 'skills', 'demo')); assert.match(readFileSync(join(f.root, '.claude/skills/demo/SKILL.md'), 'utf8'), /name: demo/);
});

test('blocks divergent instructions and Claude tool dialect without mutation', t => {
  const f = fixture(t); f.write('AGENTS.md', '# Shared\n'); f.write('CLAUDE.md', '# Different\n'); f.write('.claude/skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo.\nallowed-tools: Task\n---\nCall Task({}).\n'); f.write('.claude/agents/reviewer.md', '---\nmodel: sonnet\n---\nReview.\n'); f.commit();
  const report = inspect(f.root); assert.deepEqual(report.eligible, { instructions: false, skills: [] }); assert.equal(report.nativeClaudeAgents, 1);
  assert.ok(report.findings.some(row => row.detail?.includes('both contain guidance'))); assert.ok(report.findings.some(row => row.detail?.includes('Claude tool dialect')));
  assert.throws(() => apply(f.root), /manual review required/);
});

test('adds a Claude import adapter to an existing AGENTS.md', t => {
  const f = fixture(t); f.write('AGENTS.md', '# Existing shared guidance\n'); f.commit();
  assert.equal(inspect(f.root).eligible.instructions, 'create-claude-import');
  const result = apply(f.root); assert.equal(result.applied.instructions, 'create-claude-import'); assert.equal(readFileSync(join(f.root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
});

test('blocks dirty skills, occupied destinations, and nonstandard entries', t => {
  const f = fixture(t); f.write('.claude/skills/dirty/SKILL.md', '---\nname: dirty\ndescription: Demo.\n---\nInitial.\n'); f.write('.claude/skills/collision/SKILL.md', '---\nname: collision\ndescription: Demo.\n---\nClaude.\n'); f.write('.agents/skills/collision/SKILL.md', '---\nname: collision\ndescription: Demo.\n---\nAgents.\n'); f.write('.claude/skills/legacy.md', 'legacy'); f.commit(); f.write('.claude/skills/dirty/SKILL.md', 'changed');
  const report = inspect(f.root); assert.deepEqual(report.eligible.skills, []);
  assert.ok(report.findings.some(row => row.detail === 'skill has uncommitted changes')); assert.ok(report.findings.some(row => row.detail === 'canonical destination is occupied')); assert.ok(report.findings.some(row => row.detail === 'nonstandard skill entry'));
});
