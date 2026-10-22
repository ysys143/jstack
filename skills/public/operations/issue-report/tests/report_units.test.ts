import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { atomicWrite } from '../../../../../runtime/os.js';
import { environment, payloadReceipt } from '../scripts/draft.js';
import { HELP } from '../scripts/main.js';
import { claudeFailures, codexFailures, errorHead } from '../scripts/scan.js';
import { clip, DEFAULT_REPO, ensure, headline, idFor, normalize, REPO_PATTERN, readConfig, redactor, roots, signature } from '../scripts/state.js';
import { AWS_KEY, fixture, GH_TOKEN, isolatedPath, JWT, transcripts, wholeWordPrefix } from './_report_helpers.js';

test('isolated Windows gh PATH keeps system PowerShell without inheriting the runner PATH', () => {
  assert.equal(isolatedPath('C:\\stub', 'win32', 'C:\\Windows'), 'C:\\stub;C:\\Windows\\System32\\WindowsPowerShell\\v1.0');
});
test('redaction replaces home, user, emails, bearer values, token shapes and profile values', () => {
  const home = fixture();
  try {
    const r = roots(home);
    mkdirSync(join(r.jstack, 'profiles/acme'), { recursive: true });
    writeFileSync(join(r.jstack, 'profiles/acme/workspace.json'), JSON.stringify({ schemaVersion: 1, account: 'ops-account-17', driveId: 'drive-secret-identifier' }));
    writeFileSync(join(r.jstack, 'profiles/acme/conventions.json'), JSON.stringify({ schemaVersion: 1, commitTypes: ['feat', 'docs', 'chore'], source: 'init' }));
    mkdirSync(join(r.jstack, 'profiles/acme/history/r1'), { recursive: true });
    writeFileSync(join(r.jstack, 'profiles/acme/history/r1/workspace.json'), JSON.stringify({ schemaVersion: 1, account: 'earlier-account-08' }));
    const redact = redactor(r, 'reportuser');
    assert.equal(redact('earlier-account-08'), '<account>', 'earlier revisions kept in history are redacted too');
    assert.equal(redact('feat docs chore init'), 'feat docs chore init', 'conventions are common words, not secrets');
    const raw = `${home}/project reportuser mail a.b@example.org Bearer xyz.123 ${GH_TOKEN} ${AWS_KEY} ${JWT} ops-account-17 drive-secret-identifier /Users/alice/x`;
    const out = redact(raw);
    for (const secret of [home, 'reportuser', 'a.b@example.org', 'xyz.123', GH_TOKEN, AWS_KEY, JWT, 'ops-account-17', 'drive-secret-identifier', 'alice']) assert.equal(out.includes(secret), false, secret);
    assert.match(out, /~\/project <user> mail <redacted> Bearer <redacted>/);
    assert.match(out, /<account> <driveId>/);
    assert.equal(redact(out), out, 'redaction is idempotent');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('signature normalization ignores paths, numbers and timestamps but keeps the surface', () => {
  const a = 'Error at /tmp/a/b.js:12 2026-09-28T01:02:03Z id 3fa9c1e0aa', b = 'Error at /var/x/y.js:99 2025-01-01T09:09:09Z id 77aa11bb22';
  assert.equal(normalize(a), normalize(b));
  assert.equal(signature('jst disk', a), signature('jst disk', b));
  assert.equal(normalize('failed for C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\jstack-report-c1J1p5/x'), normalize('failed for /other/y'));
  assert.notEqual(signature('jst disk', a), signature('jst report', a));
  assert.equal(idFor(signature('x', a)).length, 16);
  assert.equal(errorHead('\nfirst\n\nsecond\nthird'), 'first\nsecond');
});
test('transcript readers keep only jstack-related failures inside the window', () => {
  const home = fixture();
  try {
    transcripts(home);
    const lines = readFileSync(join(home, '.claude/projects/-work-project/session.jsonl'), 'utf8').split('\n');
    const since = Date.now() - 3_600_000, until = Date.now() + 60_000;
    const claude = claudeFailures(lines, since, until);
    assert.deepEqual(claude.map(f => f.surface).sort(), ['hook:check_model_versions', 'jst disk']);
    assert.equal(claude.some(f => f.text.includes('private conversation')), false);
    assert.equal(claude.some(f => f.text.includes('old failure')), false);
    const codex = codexFailures(readFileSync(join(home, '.codex/sessions/2026/09/28/rollout.jsonl'), 'utf8').split('\n'), since, until);
    assert.equal(codex.length, 1); assert.equal(codex[0].surface, 'jst report'); assert.match(codex[0].text, /exit 2/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('Codex custom tool output detects failed jstack calls without treating successful or unrelated calls as failures', () => {
  const at = new Date().toISOString(), since = Date.now() - 60_000, until = Date.now() + 60_000;
  const rows = [
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', call_id: 'failed', input: 'jst report scan' } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'failed', output: [{ type: 'text', text: 'Script completed\nWall time: 0.1 seconds\nOutput:\n{"exit_code":2,"output":"Scan failed"}' }] } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', call_id: 'success', input: 'jst disk status' } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'success', output: [{ type: 'text', text: 'Script completed\nWall time: 0.1 seconds\nOutput:\n{"exit_code":0,"output":"ready"}' }] } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', call_id: 'script-failed', input: 'jst report draft' } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'script-failed', output: [{ type: 'text', text: 'Script failed\nWall time: 0.1 seconds\nOutput:\nScript error: draft unavailable' }] } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', call_id: 'unrelated', input: 'other-tool status' } },
    { timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'unrelated', output: [{ type: 'text', text: 'Script failed\nOutput:\nOther failure' }] } },
  ];
  const found = codexFailures(rows.map(row => JSON.stringify(row)), since, until);
  assert.deepEqual(found.map(row => row.surface), ['jst report', 'jst report']);
  assert.match(found[0].error, /Scan failed/);
  assert.match(found[1].error, /draft unavailable/);
});
test('--home ignores host-root environment overrides; the environment applies otherwise', () => {
  const env = { CLAUDE_CONFIG_DIR: '/elsewhere/claude', CODEX_HOME: '/elsewhere/codex' };
  assert.equal(roots('/h', env).claude, join('/h', '.claude'));
  assert.equal(roots('/h', env).codex, join('/h', '.codex'));
  assert.equal(roots(undefined, env).claude, '/elsewhere/claude');
  assert.equal(roots(undefined, env).codex, '/elsewhere/codex');
});
test('a repository slug is a GitHub OWNER/NAME pair and never reads as an option or a path', () => {
  const accepted = [DEFAULT_REPO, 'a/b', 'a-b/c', 'octocat_acme/tool', 'owner/.github', 'owner/a.b_c-d', 'owner/name.js', 'owner/-x', `${'a'.repeat(39)}/${'b'.repeat(100)}`];
  for (const slug of accepted) assert.ok(REPO_PATTERN.test(slug), `${slug} is accepted`);
  const rejected = ['', 'owner', '/x', 'a/', '/', 'a//b', 'a/b/c', '-b/x', '--help/x', 'a-/x', '.a/b', 'a.b/c', '_a/b', 'a b/c', 'a/b c', 'a/b\n', 'a/b\u00e9',
    '../..', './x', 'a/.', 'a/..', 'a/b.git', 'https://github.com/a/b', 'git@github.com:a/b', `${'a'.repeat(40)}/b`, `a/${'b'.repeat(101)}`];
  for (const slug of rejected) assert.equal(REPO_PATTERN.test(slug), false, `${JSON.stringify(slug)} is rejected`);
  const home = fixture();
  try {
    const r = roots(home); ensure(r);
    atomicWrite(join(r.reports, 'config.json'), Buffer.from(JSON.stringify({ repo: '-b/x', lastRetro: null })));
    assert.equal(readConfig(r).repo, DEFAULT_REPO, 'a configured slug that reads as an option falls back to the default');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('clip shortens a line at a word boundary and marks the cut', () => {
  assert.equal(clip('short  text\n', 160), 'short  text', 'ordinary spaces stay');
  const source = "SKILL.md instructs 'Run jst disk context and jst disk status first', but installing the plugin from the marketplace (0.9.8) puts no jstack on PATH: zsh 'command not found: jstack'. The CLI is only available through the optional npm route.";
  for (const limit of [160, 100, 80]) wholeWordPrefix(clip(source, limit), source, limit);
  assert.equal(clip(clip(source, 160), 100), clip(source, 100), 'a title cut from a cut Summary equals a direct cut');
  assert.equal(clip('alpha beta gamma', 11), 'alpha beta…', 'a limit that lands on a space keeps the last whole word');
  assert.equal(clip('x'.repeat(200), 160), `${'x'.repeat(159)}…`, 'one unbroken token is cut at the limit');
  assert.equal(clip('보고서 초안이 요약을 단어 중간에서 자르지 않는다', 12), '보고서 초안이 요약을…');
  const wide = String.fromCodePoint(0x20000);
  assert.equal(clip(wide.repeat(100), 12), `${wide.repeat(5)}…`, 'a hard cut never splits a surrogate pair');
});
test('clip keeps the cut text when trimming its separators would leave nothing', () => {
  assert.equal(clip('(`' + 'x'.repeat(300), 160), '(`' + 'x'.repeat(157) + '…');
  assert.equal(clip('('.repeat(300), 160), '('.repeat(159) + '…');
  const command = '- `jst report scan --since 2026-10-01T00:00:00Z --hours 24 --home /tmp/work/a/very/long/path/that/keeps/going/and/going/until/it/passes/the/limit/of/the/summary/line`';
  const kept = clip(command, 160);
  assert.ok(kept.startsWith('- `jst report scan --since'), kept); assert.ok(kept.length > 100, kept);
});
test('clip keeps literal backticks, asterisks and brackets and the words around them', () => {
  const sources = [
    "cp: cannot stat `/Users/<user>/.jstack/marketplace/plugins/claude/jstack/payload': No such file or directory while jst update replaced the claude host",
    "bash: -c: line 1: syntax error near unexpected token `(' while running the jst report scan step of the daily retrospective for both hosts today",
    'Computing 2**31 overflowed when the scanner counted the bytes of each transcript line again and again until the buffer gave out',
    'values [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]',
    'Error in `2**8` computation while the scanner read the transcript lines of the Codex session index that moved after the update',
    'see [the docs](https://example.invalid/a/long/path) for the report scan step that failed while the Codex session index was read',
  ];
  for (const source of sources) for (const limit of [100, 120]) wholeWordPrefix(clip(source, limit), source, limit);
  assert.equal(clip("cannot stat `/x': No such file", 160), "cannot stat `/x': No such file", 'a short line is unchanged');
  for (const short of ['short', 'a `b', '**bold', '[1, 2', '(`', '2**31']) assert.equal(clip(short, 160), short, short);
  assert.equal(clip(' line one\n\tline two\r\n ', 160), 'line one line two', 'line breaks and tabs become one space and the ends are trimmed');
});
test('clip collapses only line breaks and tabs and keeps ordinary spaces', () => {
  assert.equal(clip('a  b', 160), 'a  b');
  assert.equal(clip(' a \n\t b ', 160), 'a   b', 'a run of line breaks and tabs becomes one space; spaces around it stay');
  assert.equal(clip('line one\r\nline two\u2028line three\u000bline four\u000cline five', 160), 'line one line two line three line four line five');
  assert.equal(clip('word  '.repeat(50), 20), 'word  word  word…', 'a cut at a space drops the spaces before the ellipsis');
});
test('clip drops terminal escapes and control characters before it cuts', () => {
  const plain = 'Error: jst report scan stopped while it read the Codex session index after the transcript directory moved, so every later retrospective stopped early';
  const colored = `\x1b[31mError:\x1b[0m ${plain.slice('Error: '.length)}\nexit 1`;
  for (const limit of [160, 100, 40]) { assert.equal(clip(headline(colored), limit), clip(plain, limit)); assert.doesNotMatch(clip(headline(colored), limit), /[\x00-\x08\x0b-\x1f\x7f]/); }
  assert.equal(clip('a\x00b\x07c\x1b[2Kd\x7fe', 160), 'abcde', 'a CSI sequence and the other C0 controls are removed');
  assert.doesNotMatch(clip('x\x1b[38;5;196m' + 'y'.repeat(300), 100), /\x1b/);
});
test('clip never ends inside a grapheme cluster', () => {
  const family = String.fromCodePoint(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467), flag = String.fromCodePoint(0x1F1F0, 0x1F1F7);
  assert.equal(clip('x' + family.repeat(10), 12), `x${family}…`, 'a joined emoji sequence is kept or dropped whole');
  assert.equal(clip('x' + flag.repeat(10), 8), `x${flag}…`, 'a flag is kept or dropped whole');
  const accent = '\u0301', chain = (String.fromCodePoint(0x1F468) + '\u200D').repeat(100_000);
  assert.equal(clip('e' + accent.repeat(300), 160), 'e' + accent.repeat(158) + '…', 'one cluster longer than the limit is cut between code points');
  assert.equal(clip(chain, 159), chain.slice(0, 158) + '…', 'a cut inside a very long joined chain ends after a whole code point');
  assert.equal(clip(chain, 158), chain.slice(0, 156) + '…', 'and never inside a surrogate pair');
});
test('the help text lists --json on submit, which prints its result only once it ran', () => {
  assert.match(HELP, /^  submit DRAFT --confirm \[--new\] \[--repo OWNER\/NAME\] \[--json\]$/m);
});
test('environment reads the managed package receipt with the receipt anomaly, then the running payload receipt', () => {
  const home = fixture();
  try {
    // An empty environment keeps the host unknown, so no host --version process runs.
    const r = roots(home), running = join(home, 'cache/jstack/0.9.7/package-receipt.json');
    const versions = () => { const e = environment(r, {}, running); return [e['jstack version'], e['Package digest']]; };
    const receipt = (file: string, value: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
    const unreceipted = ['not installed through jst install (no installation receipt)', 'unknown'];
    assert.deepEqual(versions(), unreceipted);
    const ownHash = 'b'.repeat(64), native = (why: string) => [`0.9.7 (running package receipt; installation receipt ${why})`, `${ownHash} (package receipt source hash)`];
    receipt(running, '{"name": "jstack"');
    assert.deepEqual(versions(), unreceipted, 'an unreadable running package receipt counts as none');
    receipt(running, { schemaVersion: 2, name: 'jstack', version: '0.9.7', publicSkills: [], sourceSha256: ownHash });
    assert.deepEqual(versions(), native('missing'), 'a host-native install names the receipt of the payload that runs and the missing installation receipt');
    const managed = join(r.jstack, 'marketplace/plugins/claude/jstack/package-receipt.json');
    receipt(managed, '{"name": "jstack"');
    assert.deepEqual(versions(), native('missing'), 'an unreadable managed package receipt counts as none');
    receipt(managed, { schemaVersion: 2, name: 'jstack', publicSkills: [] });
    assert.deepEqual(versions(), native('missing'), 'a managed package receipt without a version counts as none');
    const hash = 'a'.repeat(64), packaged = (why: string) => [`claude 0.9.8 (package receipt; installation receipt ${why})`, `claude ${hash} (package receipt source hash)`];
    receipt(managed, { schemaVersion: 2, name: 'jstack', version: '0.9.8', publicSkills: [], sourceSha256: hash });
    assert.deepEqual(versions(), packaged('missing'), 'a managed package receipt wins and keeps the missing installation receipt visible');
    atomicWrite(join(r.jstack, 'installation.json'), Buffer.from('{"hosts":'));
    assert.deepEqual(versions(), packaged('unreadable'));
    atomicWrite(join(r.jstack, 'installation.json'), Buffer.from(JSON.stringify({ hosts: {} })));
    assert.deepEqual(versions(), packaged('lists no hosts'));
    atomicWrite(join(r.jstack, 'installation.json'), Buffer.from(JSON.stringify({ hosts: { claude: { version: '1.2.3', digest: 'd' } } })));
    assert.deepEqual(versions(), ['claude 1.2.3', 'claude d'], 'the installation receipt wins');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('environment reads only the claude and codex entries, skips malformed ones and names the installation receipt problem', () => {
  const home = fixture();
  try {
    const r = roots(home), running = join(home, 'cache/jstack/0.9.7/package-receipt.json');
    const managed = join(r.jstack, 'marketplace/plugins/claude/jstack/package-receipt.json'), hash = 'a'.repeat(64), own = 'b'.repeat(64);
    mkdirSync(dirname(managed), { recursive: true }); mkdirSync(dirname(running), { recursive: true });
    const versions = (installation: string | undefined) => { const file = join(r.jstack, 'installation.json'); if (installation === undefined) rmSync(file, { force: true }); else writeFileSync(file, installation); const e = environment(r, {}, running); return [e['jstack version'], e['Package digest']]; };
    const bad = [['{"hosts":', 'unreadable'], ['null', 'malformed'], ['[]', 'malformed'], ['7', 'malformed'], ['"hosts"', 'malformed'], ['{}', 'lists no hosts'], ['{"hosts":{}}', 'lists no hosts'],
      ['{"hosts":{"other":{"version":"1"}}}', 'lists no hosts'], ['{"hosts":null}', 'malformed'], ['{"hosts":"claude"}', 'malformed'], ['{"hosts":[{"version":"1.2.3"}]}', 'malformed'],
      ['{"hosts":{"claude":null}}', 'malformed'], ['{"hosts":{"claude":"x","codex":7}}', 'malformed'], ['{"hosts":{"claude":[]}}', 'malformed']];
    // Without any package receipt the draft still names which installation receipt problem it found.
    for (const [installation, why] of bad) assert.deepEqual(versions(installation), [`unknown (installation receipt ${why})`, 'unknown'], installation);
    assert.deepEqual(versions(undefined), ['not installed through jst install (no installation receipt)', 'unknown']);
    // The running payload receipt keeps naming the problem instead of calling every case missing.
    writeFileSync(running, JSON.stringify({ name: 'jstack', version: '0.9.7', sourceSha256: own }));
    for (const [installation, why] of [...bad, [undefined, 'missing']] as [string | undefined, string][]) assert.deepEqual(versions(installation), [`0.9.7 (running package receipt; installation receipt ${why})`, `${own} (package receipt source hash)`], `${installation}`);
    writeFileSync(managed, JSON.stringify({ name: 'jstack', version: '0.9.8', sourceSha256: hash }));
    for (const [installation, why] of [...bad, [undefined, 'missing']] as [string | undefined, string][]) assert.deepEqual(versions(installation), [`claude 0.9.8 (package receipt; installation receipt ${why})`, `claude ${hash} (package receipt source hash)`], `${installation}`);
    assert.deepEqual(versions('{"hosts":{"claude":null,"codex":{"version":"1.2.3","digest":"d"},"extra":{"version":"x"},"__proto__":{"version":"y"}}}'), ['codex 1.2.3', 'codex d'], 'a valid entry survives beside malformed ones; other keys are not read');
    assert.deepEqual(versions(JSON.stringify({ hosts: { claude: { version: 9, digest: {} } } })), ['claude ?', 'claude ?'], 'a non-string field reads as unknown');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('environment lines carry no control character or newline and stay short, whatever a receipt holds', () => {
  const home = fixture();
  try {
    const r = roots(home), running = join(home, 'cache/jstack/0.9.7/package-receipt.json'), managed = join(r.jstack, 'marketplace/plugins/claude/jstack/package-receipt.json');
    mkdirSync(dirname(managed), { recursive: true }); mkdirSync(dirname(running), { recursive: true });
    const hostile = '1.0\n## Injected heading\n- Node: fake\u001b[31m' + 'z'.repeat(500), versions = () => { const e = environment(r, {}, running); return [e['jstack version'], e['Package digest']]; };
    // A line is one host name plus at most 80 characters of receipt text and a short note, per host.
    const flat = (values: string[]) => { for (const value of values) { assert.doesNotMatch(value, /[\u0000-\u001f\u007f]/); assert.ok(value.length <= 200, `${value.length} > 200`); } };
    writeFileSync(join(r.jstack, 'installation.json'), JSON.stringify({ hosts: { claude: { version: hostile, digest: hostile }, codex: { version: hostile, digest: hostile } } }));
    flat(versions());
    rmSync(join(r.jstack, 'installation.json'));
    writeFileSync(managed, JSON.stringify({ name: 'jstack', version: hostile, sourceSha256: hostile }));
    flat(versions());
    rmSync(managed);
    writeFileSync(running, JSON.stringify({ name: 'jstack', version: hostile, sourceSha256: hostile }));
    flat(versions());
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('the running package receipt sits beside the payload that holds the executing script', () => {
  const root = join(tmpdir(), 'pkg');
  assert.equal(payloadReceipt(join(root, 'payload/skills/issue-report/scripts/draft.js')), join(root, 'package-receipt.json'));
  assert.equal(payloadReceipt(join(root, 'payload/cli/payload/main.js')), join(root, 'payload/cli/package-receipt.json'), 'the nearest payload directory wins');
  assert.equal(payloadReceipt(join(root, 'dist/skills/public/operations/issue-report/scripts/draft.js')), undefined, 'a source checkout has no package receipt');
});
