import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './decision_cli.js';
import { recommendProjectChecks } from './recommend.js';
import { HOOK_CONTEXT_ENV, StateConflict, claimPendingPrompt, readState, recordDecision, resolveStateLocation } from './state.js';
import { computeFingerprint, diagnosticReuse, retryAllowed } from './fingerprint.js';
import { planActions } from './plan.js';
import { selectCheckers, type ProjectView } from './select.js';

const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const view = (files: Record<string, string>): ProjectView => ({
  exists: rel => Object.hasOwn(files, rel),
  read: rel => files[rel],
});

test('project decision CLI needs explicit evidence and stores both choices outside .jstack', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-decision-cli-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    const location = resolveStateLocation(root);
    assert.equal((run(['status'], {}, root) as any).decision, 'undecided');
    assert.equal(existsSync(location.file), false);
    assert.throws(() => run(['choose', 'configured'], {}, root), /message-ref/);
    assert.throws(() => run(['choose', 'configured', '--message-ref', 'reply-1'], { [HOOK_CONTEXT_ENV]: '1' }, root), /not from a hook/);
    assert.equal(existsSync(location.file), false);
    assert.equal((run(['choose', 'configured', '--message-ref', 'reply-1', '--host', 'claude'], {}, root) as any).decision, 'configured');
    assert.equal(readState(location).state.approval?.messageRef, 'reply-1');
    assert.equal(existsSync(join(root, '.jstack')), false);
    assert.equal((run(['choose', 'without-setup', '--message-ref', 'reply-2'], {}, root) as any).decision, 'without-setup');
    assert.equal((run(['reopen', '--message-ref', 'reply-3'], {}, root) as any).decision, 'undecided');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('project recommendation is read-only and needs both key and point for a shadow request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-project-recommend-'));
  try {
    assert.equal(git(root, ['init', '-q']).status, 0);
    writeFileSync(join(root, 'pyproject.toml'), '[tool.ruff]\n');
    const location = resolveStateLocation(root);
    const stateHome = join(root, 'state-home');
    let calls = 0;
    const fetchFn = (async () => { calls++; throw new Error('request should be disabled'); }) as typeof fetch;
    const pending = await recommendProjectChecks(root, ['src/main.py'], { stateHome, env: { TYPESAFE_API_KEY: 'fixture-key' }, fetchFn });
    assert.equal(pending.recommendation, 'ask-user');
    assert.equal(pending.jevMode, 'off');
    assert.equal(calls, 0);
    assert.equal(existsSync(location.file), false);
    assert.equal(existsSync(stateHome), false);
    assert.equal(existsSync(join(root, '.jstack')), false);
    assert.equal((await recommendProjectChecks(root, [], { stateHome, env: { JSTACK_JEV: 'project-checks', TYPESAFE_API_KEY: 'fixture-key' }, fetchFn })).recommendation, 'no-check');
    assert.equal(calls, 0);
    assert.equal((await recommendProjectChecks(root, ['single.py'], { stateHome, env: {} })).recommendation, 'ask-user');
    await assert.rejects(() => recommendProjectChecks(root, ['../outside.py']), /cannot escape/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('project recommendation compares a bounded Jev choice without granting setup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-project-shadow-'));
  try {
    assert.equal(git(root, ['init', '-q']).status, 0);
    writeFileSync(join(root, 'pyproject.toml'), '[tool.ruff]\n');
    const location = resolveStateLocation(root);
    recordDecision(location, { approval: { provenance: 'explicit-command', choice: 'configured', host: 'claude', recordedAt: new Date().toISOString(), messageRef: 'fixture-user-command' }, expectedRevision: 0 });
    let sent: any;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ model: 'jev-latest', usage: { input_tokens: 2, output_tokens: 1 }, answers: { decision: {
        type: 'choice', choice: 'ask-user', confidence: 0.8, probabilities: { 'use-existing': 0.1, 'offer-setup': 0.1, 'ask-user': 0.8 },
      } } }), { status: 200 });
    }) as typeof fetch;
    const result = await recommendProjectChecks(root, ['src/main.py'], { stateHome: join(root, 'local-state'),
      env: { JSTACK_JEV: 'project-checks', TYPESAFE_API_KEY: 'fixture-key' }, fetchFn });
    assert.equal(result.recommendation, 'use-existing');
    assert.equal(result.jevMode, 'shadow');
    assert.deepEqual(sent.state, { point: 'project-checks', languages: ['python'], projectDecision: 'configured', configuredCheckerCount: 1, missingManifestCount: 0, missingCheckerCount: 0 });
    assert.equal(readState(location).state.decision, 'configured');
    const revision = readState(location).state.revision;
    recordDecision(location, { approval: { provenance: 'explicit-command', choice: 'without-setup', host: 'claude', recordedAt: new Date().toISOString(), messageRef: 'fixture-no-setup' }, expectedRevision: revision });
    const refused = await recommendProjectChecks(root, ['src/main.py'], { env: { JSTACK_JEV: 'project-checks', TYPESAFE_API_KEY: 'fixture-key' }, fetchFn });
    assert.equal(refused.recommendation, 'respect-no-setup');
    assert.equal(refused.jevMode, 'off');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worktree decisions are separate, while subdirectories share their worktree state', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jstack-worktree-state-'));
  const root = join(parent, 'main'), sibling = join(parent, 'linked');
  try {
    mkdirSync(root);
    assert.equal(git(root, ['init', '-q']).status, 0);
    writeFileSync(join(root, 'README.md'), 'fixture\n');
    assert.equal(git(root, ['add', 'README.md']).status, 0);
    assert.equal(git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial']).status, 0);
    assert.equal(git(root, ['worktree', 'add', '--detach', sibling, 'HEAD']).status, 0);
    mkdirSync(join(root, 'nested'));
    const main = resolveStateLocation(root), nested = resolveStateLocation(join(root, 'nested')), linked = resolveStateLocation(sibling);
    assert.equal(main.file, nested.file);
    assert.notEqual(main.file, linked.file);
    assert.equal(main.kind, 'git');
    assert.equal(linked.kind, 'git');
    recordDecision(main, { approval: { provenance: 'explicit-command', choice: 'without-setup', host: 'codex', recordedAt: new Date().toISOString(), messageRef: 'fixture-user-command' }, expectedRevision: 0 });
    assert.equal(readState(main).state.decision, 'without-setup');
    assert.equal(readState(linked).state.decision, 'undecided');
    assert.equal(existsSync(join(root, '.jstack')), false);
    assert.equal(existsSync(join(sibling, '.jstack')), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('non-Git state is path-keyed; malformed state is never silently repaired by a hook', () => {
  const parent = mkdtempSync(join(tmpdir(), 'jstack-directory-state-'));
  const home = join(parent, 'state'), first = join(parent, 'first'), second = join(parent, 'second');
  try {
    mkdirSync(first); mkdirSync(second);
    const one = resolveStateLocation(first, { stateHome: home }), two = resolveStateLocation(second, { stateHome: home });
    assert.equal(one.kind, 'directory');
    assert.notEqual(one.file, two.file);
    recordDecision(one, { approval: { provenance: 'explicit-command', choice: 'configured', host: 'claude', recordedAt: new Date().toISOString(), messageRef: 'fixture-user-command' }, expectedRevision: 0 });
    assert.equal(readState(two).status, 'missing');
    writeFileSync(one.file, '{broken json'); chmodSync(one.file, 0o600);
    const broken = readState(one);
    assert.equal(broken.status, 'malformed');
    assert.equal(broken.state.decision, 'undecided');
    assert.equal(claimPendingPrompt(one, { host: 'claude' }).claimed, true);
    assert.equal(readState(one).status, 'malformed');
    assert.throws(() => recordDecision(one, { approval: { provenance: 'explicit-command', choice: 'configured', host: 'claude', recordedAt: new Date().toISOString(), messageRef: 'fixture-user-command' }, expectedRevision: 1 }), StateConflict);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('prompt claim is deduplicated and an explicit answer survives a stale writer', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-pending-state-'));
  try {
    assert.equal(git(root, ['init', '-q']).status, 0);
    const location = resolveStateLocation(root);
    const now = Date.now();
    assert.equal(claimPendingPrompt(location, { host: 'claude', now }).claimed, true);
    assert.equal(claimPendingPrompt(location, { host: 'codex', now: now + 1000 }).claimed, false);
    const revision = readState(location).state.revision;
    recordDecision(location, { approval: { provenance: 'explicit-command', choice: 'without-setup', host: 'codex', recordedAt: new Date().toISOString(), messageRef: 'fixture-user-command' }, expectedRevision: revision });
    assert.equal(claimPendingPrompt(location, { host: 'claude', now: now + 700000 }).claimed, false);
    assert.throws(() => recordDecision(location, { approval: { provenance: 'explicit-command', choice: 'configured', host: 'claude', recordedAt: new Date().toISOString(), messageRef: 'stale-command' }, expectedRevision: revision }), StateConflict);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mixed-language selection is limited to affected subprojects and keeps unknown gaps', () => {
  const project = view({
    'py/pyproject.toml': '[tool.ruff]\n',
    'web/package.json': '{"scripts":{"lint":"eslint .","typecheck":"tsc --noEmit"}}',
    'go/go.mod': 'module example.invalid/go\n',
    'rs/Cargo.toml': '[package]\nname="fixture"\nversion="0.1.0"\n',
    'loose/requirements.txt': 'lxml\n',
  });
  const selected = selectCheckers(['py/a.py', 'web/a.ts', 'go/a.go', 'rs/src/lib.rs', 'loose/a.py', 'README.md'], project);
  assert.deepEqual(selected.selections.map(row => row.id), ['go#go-vet#lint', 'py#ruff#lint', 'rs#clippy#lint', 'web#package-script#lint', 'web#package-script#typecheck']);
  assert.equal(selected.ignored.includes('README.md'), true);
  assert.equal(selected.gaps.some(gap => gap.offer === 'create-pyproject'), true);
  assert.equal(selected.selections.some(row => row.kind === 'format'), false);
  const format = selectCheckers(['py/a.py'], project, { formatOptIn: true });
  assert.equal(format.selections.some(row => row.kind === 'format'), true);
  const standalone = selectCheckers(['single.py'], view({}));
  assert.equal(standalone.gaps[0]?.kind, 'standalone-script');
  assert.equal(standalone.gaps[0]?.offer, undefined);
});

test('a diagnostic reuses only a matching pass and a no-setup choice never runs checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-fingerprint-'));
  try {
    writeFileSync(join(root, 'pyproject.toml'), '[tool.ruff]\n');
    const input = { root, host: 'claude', jstackVersion: '0.9.7', configFiles: ['pyproject.toml'], lockFiles: [], tools: [] };
    const original = computeFingerprint(input);
    const state = { diagnostic: { status: 'pass' as const, checkedAt: new Date().toISOString(), fingerprint: original, attempts: 0 } };
    assert.equal(diagnosticReuse(state, original).reuse, true);
    assert.equal(retryAllowed(state.diagnostic, 'read-only', original), false);
    writeFileSync(join(root, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n');
    const changed = computeFingerprint(input);
    assert.notEqual(changed.digest, original.digest);
    assert.deepEqual(diagnosticReuse(state, changed).changed, ['config:pyproject.toml']);
    assert.equal(retryAllowed(state.diagnostic, 'commit', changed), true);
    const noSetup = planActions({ trigger: 'commit', state: { decision: 'without-setup', status: 'ok' }, changes: [{ relative: 'a.py', op: 'update' }], view: view({ 'pyproject.toml': '[tool.ruff]\n' }) });
    assert.equal(noSetup.gate, 'skip');
    assert.equal(noSetup.actions.length, 0);
    const pending = planActions({ trigger: 'commit', state: { decision: 'undecided', status: 'missing' }, changes: [{ relative: 'a.py', op: 'update' }], view: view({ 'pyproject.toml': '[tool.ruff]\n' }) });
    assert.equal(pending.gate, 'pending-decision');
    assert.equal(pending.actions.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
