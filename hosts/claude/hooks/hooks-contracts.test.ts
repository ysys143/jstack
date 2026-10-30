import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { autocommitEnabled, prompt } from './commit-session.js';
import { DEFAULT_CONVENTIONS } from '../../../runtime/conventions.js';
import { parsePublishSource, validate } from './validate_before_publish.js';
import { parseRuffOutput, checkAfterEdit } from './ruff_check_after_edit.js';
import { commandDirectory, groupKey, judge, parseLabels, loadPolicy, fingerprint, readDeclared, type Policy } from './validate_pr_label.js';
import { checkContent } from './check_model_versions.js';
import { getAllModelNames, checkModelStatus } from '../../../scripts/models_database.js';
import { runProjectLane } from './hook-project.js';
import { diagnosticReuse, readState, recordDecision, resolveStateLocation } from '../../../runtime/project-hooks/index.js';
import type { NormalizedEvent } from './hook-event.js';
import { legacyInputs, normalize } from './hook-event.js';
import { dispatch, evaluate } from './dispatch.js';
import { applicable, type Policy as DispatchPolicy } from './hook-policies.js';
test('autocommit defaults off and kill switch overrides file', () => { const root = mkdtempSync(join(tmpdir(), 'jstack-stop-')); try {
    assert.equal(autocommitEnabled(root, ''), false);
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude/session-autocommit'), '');
    assert.equal(autocommitEnabled(root, ''), true);
    for (const value of ['0', 'false', 'off', 'no'])
        assert.equal(autocommitEnabled(root, value), false);
    for (const value of ['1', 'true', 'on', 'yes'])
        assert.equal(autocommitEnabled(root, value), true);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('publish parsing preserves spaces and cd; substitutions/missing source block', () => { assert.equal(parsePublishSource('cd "my project" && bash register_local.sh "plugin space"', '/tmp'), resolve('/tmp/my project/plugin space')); for (const command of ['register_local.sh', 'register_local.sh && echo x', 'register_local.sh $(echo foo)', 'register_local.sh "unterminated'])
    assert.equal(validate({ tool_name: 'Bash', tool_input: { command } }).code, 1); assert.equal(validate({ tool_name: 'Read', tool_input: { command: 'register_local.sh' } }).code, 0); assert.equal(validate({ tool_name: 'Bash', tool_input: { command: 'echo $(pwd)' } }).code, 0); });
test('ruff classification retains Windows paths and separates manual fixes', () => { const [fixable, manual] = parseRuffOutput('C:\\repo\\a.py:10:1: F401 unused import\na.py:2:1: UP006 use list\na.py:4:1: E999 invalid syntax\nFound 3 errors.'); assert.equal(fixable.length, 2); assert.equal(manual.length, 1); assert.equal(fixable[0].location, 'C:\\repo\\a.py:10:1'); assert.equal(manual[0].code, 'E999'); assert.equal(checkAfterEdit({ tool_name: 'Read', tool_input: { file_path: 'foo.py' } }), undefined); });
test('PR declared policy, weak confidence, absent/empty/broken distinctions', () => { const root = mkdtempSync(join(tmpdir(), 'jstack-pr-policy-')); try {
    assert.equal(loadPolicy(root)[0], 'missing');
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude/pr-policy.json'), '');
    assert.equal(loadPolicy(root)[0], 'empty');
    writeFileSync(join(root, '.claude/pr-policy.json'), 'invalid');
    assert.equal(loadPolicy(root)[0], 'broken');
    writeFileSync(join(root, 'AGENTS.md'), 'Required labels:\n\n- `@web`\n- `type:bug`\n');
    const [declared] = readDeclared(root);
    assert.deepEqual([...declared], ['@web', 'type:bug']);
    assert.equal(groupKey('@web'), '@');
    assert.equal(groupKey('type:bug'), 'type:');
    const fp = fingerprint(new Set(['@web']), root);
    writeFileSync(join(root, 'AGENTS.md'), 'Required label: `@api`\n');
    assert.notEqual(fingerprint(new Set(['@web']), root), fp);
    const policy = { rules: [{ group: '@', allowed: ['@web'] }], observed_prs: 50, confidence: 0.9, enforced: true } as Policy;
    assert.match(judge([], policy)[0]!, /do not satisfy/);
    assert.deepEqual(judge(parseLabels('gh pr create --label "@web"'), policy), [undefined, undefined]);
    assert.match(judge([], { ...policy, enforced: false })[1]!, /too low to block/);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('PR label judges the repository the PR command runs in', () => { const root = mkdtempSync(join(tmpdir(), 'jstack-pr-dir-')); try {
    const home = homedir();
    assert.equal(commandDirectory('cd /target/repo && gh pr create --title t', root), resolve('/target/repo'));
    assert.equal(commandDirectory('cd sub && gh pr create', root), resolve(root, 'sub'));
    assert.equal(commandDirectory('cd "/a b" && cd c; gh pr create', root), resolve('/a b', 'c'));
    assert.equal(commandDirectory('(cd /target && gh pr create)', root), resolve('/target'));
    assert.equal(commandDirectory('cd ~/repo && gh pr create', root), join(home, 'repo'));
    assert.equal(commandDirectory('gh pr create; cd /elsewhere', root), root);
    assert.equal(commandDirectory('cd /first && cd $SOMEWHERE && gh pr create', root), undefined);
    assert.equal(commandDirectory('cd - && gh pr create', root), undefined);
    assert.equal(commandDirectory('echo "gh pr create"', root), undefined);
    const event = { host: 'claude', event: 'PreToolUse', toolName: 'Bash', kind: 'shell', command: 'gh pr create', changes: [], cwd: root, raw: {} } as unknown as NormalizedEvent;
    assert.equal(legacyInputs(event)[0]?.cwd, root);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('model checker covers unknown, approved, notebook, block and Bash warning distinction', () => {
    // Derive the sample from the database so this contract does not rot when a roster entry changes status.
    const outdated = [...getAllModelNames()].find(name => checkModelStatus(name)[1]?.status === 'outdated')!;
    assert.ok(outdated, 'the database must carry at least one outdated model');
    assert.match(checkContent('test.py', `model="gpt-imaginary"`, [])!, /^WARN_ONLY:/);
    assert.equal(checkContent('', `model="gpt-imaginary"`, [], true), undefined);
    assert.equal(checkContent('test.py', `model="${outdated}"`, [outdated]), undefined);
    assert.match(checkContent('test.ipynb', `model="${outdated}"`, [])!, /OUTDATED/);
    assert.equal(checkContent('image.png', `model="${outdated}"`, []), undefined);
    assert.ok(getAllModelNames().size > 50);
    assert.equal(checkModelStatus(`openai:${outdated}`)[0], true);
    assert.equal(checkModelStatus('not-a-model')[1], undefined);
});
test('project diagnostic records the completed checker result, never an availability-only pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jstack-project-check-'));
    try {
        assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
        writeFileSync(join(root, 'pyproject.toml'), '[tool.ruff]\n');
        writeFileSync(join(root, 'a.py'), 'x = 1\n');
        assert.equal(spawnSync('git', ['add', 'pyproject.toml', 'a.py'], { cwd: root }).status, 0);
        const location = resolveStateLocation(root);
        recordDecision(location, { approval: {
            provenance: 'explicit-command', choice: 'configured', host: 'claude',
            recordedAt: new Date().toISOString(), messageRef: 'test-command-invocation',
        }, expectedRevision: 0 });
        const event: NormalizedEvent = {
            host: 'claude', event: 'PreToolUse', toolName: 'Bash', kind: 'shell',
            command: 'git commit -m test', changes: [], cwd: root, raw: {},
        };
        const env = { ...process.env };
        const failed = await runProjectLane(event, env, { runAction: () => ({ action: 'deny', policy: 'project', text: 'lint failed' }) });
        assert.ok(failed.some(verdict => verdict.action === 'deny'));
        const first = readState(location);
        assert.equal(first.status, 'ok');
        assert.equal(first.state.diagnostic?.status, 'fail');
        assert.equal(first.state.diagnostic?.attempts, 1);
        assert.equal(diagnosticReuse(first.state, first.state.diagnostic!.fingerprint).reuse, false);
        const passed = await runProjectLane(event, env, { runAction: () => undefined });
        assert.equal(passed.some(verdict => verdict.action === 'deny'), false);
        const second = readState(location);
        assert.equal(second.state.diagnostic?.status, 'pass');
        assert.equal(diagnosticReuse(second.state, second.state.diagnostic!.fingerprint).reuse, true);
    }
    finally { rmSync(root, { recursive: true, force: true }); }
});
test('dispatcher normalizes Codex shell and patch events before applying guards', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jstack-dispatch-'));
    try {
        const benign = await dispatch(JSON.stringify({ tool_name: 'exec_command', tool_input: { cmd: 'pwd' }, cwd }), 'PreToolUse', 'codex');
        assert.equal(benign.exitCode, 0);
        assert.equal(benign.stdout, '');
        const shell = await dispatch(JSON.stringify({ tool_name: 'exec_command', tool_input: { cmd: 'echo "😀" > x.py' }, cwd }), 'PreToolUse', 'codex');
        assert.equal(JSON.parse(shell.stdout).hookSpecificOutput.permissionDecision, 'deny');
        const patch = '*** Begin Patch\n*** Add File: x.py\n+print("😀")\n*** End Patch';
        const event = normalize({ tool_name: 'apply_patch', tool_input: { command: patch }, cwd }, 'PreToolUse', 'codex');
        assert.equal(event.kind, 'edit');
        assert.equal(event.changes[0]?.op, 'add');
        const edited = await dispatch(JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: patch }, cwd }), 'PreToolUse', 'codex');
        assert.equal(JSON.parse(edited.stdout).hookSpecificOutput.permissionDecision, 'deny');
        const malformed = await dispatch(JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: 'not a patch' }, cwd }), 'PreToolUse', 'codex');
        assert.match(JSON.parse(malformed.stdout).hookSpecificOutput.additionalContext, /UNKNOWN/);
    }
    finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('ai-attribution is selected for git and gh option forms and for no other command', () => {
    const cwd = process.cwd();
    const ids = (tool_name: string, tool_input: object) => applicable(normalize({ tool_name, tool_input, cwd }, 'PreToolUse', 'claude'), {}).map(policy => policy.id);
    for (const command of ['git commit -m x', 'git -C sub commit -m x', 'gh pr create --title t', 'gh -R owner/repo pr create --title t', 'bash -c "git commit -m x"'])
        assert.ok(ids('Bash', { command }).includes('ai-attribution'), command);
    for (const command of ['ls -la', 'echo hello', 'git status', 'npm test'])
        assert.equal(ids('Bash', { command }).includes('ai-attribution'), false, command);
    assert.equal(ids('Write', { file_path: 'a.txt', content: 'git commit' }).includes('ai-attribution'), false);
});
test('dispatcher denies AI attribution in commits and PR bodies on both hosts', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jstack-attribution-'));
    // The project lane is a separate policy; switching it off keeps the clean-commit assertions about this policy alone.
    const env = { ...process.env, JSTACK_PROJECT_HOOKS: '0' };
    try {
        writeFileSync(join(cwd, 'msg.txt'), 'feat: add x\n\nClaude-Session: abc\n');
        const trailer = 'feat: add x\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>';
        const run = async (tool_name: string, tool_input: object, host: string) => dispatch(JSON.stringify({ tool_name, tool_input, cwd }), 'PreToolUse', host, env);
        const denial = async (tool_name: string, tool_input: object, host: string) => JSON.parse((await run(tool_name, tool_input, host)).stdout || '{}').hookSpecificOutput?.permissionDecision;
        // Codex exec_command carries the command in `cmd`; only the dispatcher normalizes it.
        assert.equal(await denial('exec_command', { cmd: `git commit -m "${trailer}"` }, 'codex'), 'deny');
        assert.equal(await denial('exec_command', { cmd: 'git commit -F msg.txt' }, 'codex'), 'deny');
        assert.equal(await denial('exec_command', { cmd: `git -C sub commit -m "${trailer}"` }, 'codex'), 'deny');
        assert.equal(await denial('Bash', { command: `git commit -m "${trailer}"` }, 'claude'), 'deny');
        // A line break the shell makes while running the command still puts the trailer on its own line in git.
        assert.equal(await denial('exec_command', { cmd: "git commit -m $'feat: add x\\n\\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>'" }, 'codex'), 'deny');
        assert.equal(await denial('Bash', { command: 'gh -R owner/repo pr create --title t --body "Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)"' }, 'claude'), 'deny');
        const reason = JSON.parse((await run('Bash', { command: `git commit -m "${trailer}"` }, 'claude')).stdout).hookSpecificOutput.permissionDecisionReason;
        assert.match(reason, /remove every line containing "Co-Authored-By: Claude"/);
        assert.match(reason, /every repository where it is enabled/);
        for (const [tool, input] of [['exec_command', { cmd: 'git commit -m "docs: explain the trailer ban"' }], ['Bash', { command: 'grep -rn "Co-Authored-By: Claude" .' }], ['Bash', { command: 'gh pr create --title t --body "Summary only"' }], ['exec_command', { cmd: 'git commit -m "feat: add x\n\nCo-authored-by: Claude Monet <claude@example.com>"' }]] as const)
            assert.equal(await denial(tool, input, 'claude'), undefined, JSON.stringify(input));
        // A message file that cannot be read passes, but the dispatcher says it was not checked.
        const missing = JSON.parse((await run('Bash', { command: 'git commit -F absent.txt' }, 'claude')).stdout);
        assert.equal(missing.hookSpecificOutput?.permissionDecision, undefined);
        assert.match(missing.systemMessage, /Unverifiable message file/);
    }
    finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('dispatcher fails closed only for marked guards and skips expensive work after denial', async () => {
    const event: NormalizedEvent = { host: 'claude', event: 'PreToolUse', toolName: 'Bash', kind: 'shell', command: 'publish', changes: [], cwd: process.cwd(), raw: {} };
    let expensiveCalls = 0;
    const policy = (id: string, failClosed: boolean, expensive: boolean, run: DispatchPolicy['run']): DispatchPolicy => ({ id, replaces: [], events: ['PreToolUse'], kinds: ['shell'], failClosed, expensive, prefilter: () => true, run });
    const verdicts = await evaluate(event, {}, [
        policy('guard', true, false, async () => { throw new Error('broken'); }),
        policy('expensive', false, true, async () => { expensiveCalls++; return []; }),
    ]);
    assert.equal(verdicts[0]?.action, 'deny');
    assert.equal(expensiveCalls, 0);
    const optional = await evaluate(event, {}, [policy('optional', false, false, async () => { throw new Error('broken'); })]);
    assert.equal(optional[0]?.action, 'unknown');
});

test('the automatic commit prompt follows the conventions it is given', () => {
  const english = prompt();
  assert.match(english, /English descriptions/); assert.match(english, /MUST be one of: feat, fix, refactor, test, docs, chore, style, remove, perf/); assert.match(english, /MAX 50 chars, imperative mood/);
  const korean = prompt({ ...DEFAULT_CONVENTIONS, autocommitLanguage: 'ko', subjectVerbEnding: 'korean', commitTypes: ['feat', 'fix'], subjectMax: 60 });
  assert.match(korean, /Korean descriptions/); assert.match(korean, /MUST be one of: feat, fix\./); assert.match(korean, /MAX 60 chars, ending in an action noun such as 추가/);
  assert.match(korean, /NEVER include 'Generated with Claude Code'/);
});
