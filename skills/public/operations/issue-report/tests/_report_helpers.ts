/** Shared fixtures for the issue-report tests: temp homes, the gh stub and a CLI runner. Not a test file, so the runner does not pick it up. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../../../../../runtime/os.js';
import { main } from '../scripts/main.js';
import { roots } from '../scripts/state.js';
import { processTemporaryDirectory } from '../../../../../runtime/fixtures/process_tmp.js';

const MAIN = fileURLToPath(new URL('../scripts/main.js', import.meta.url));
export const fixture = () => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'jstack-report-')));
// Credential-shaped fixtures are assembled at runtime so the package never ships a token-shaped literal.
const token = (prefix: string, body: string) => prefix + body;
export const GH_TOKEN = token('gh' + 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4');
export const AWS_KEY = token('AK' + 'IA', 'ABCDEFGHIJKLMNOP');
export const JWT = ['ey' + 'JhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlLXZhbHVl'].join('.');
export function isolatedPath(stub: string, platform = process.platform, systemRoot = process.env.SystemRoot ?? process.env.WINDIR): string {
  if (platform !== 'win32') return stub;
  if (!systemRoot) throw new Error('Windows system root is required for ACL tests');
  return `${stub};${win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')}`;
}
/**
 * A gh stub on an otherwise empty PATH; every invocation is logged so tests can prove what ran.
 * One stub serves the whole run because macOS scans each new executable on its first launch.
 * POSIX runs a /bin/sh script that needs only shell builtins, so a call starts no second node
 * process; Windows runs the equivalent node script. Both log each argument followed by U+001F.
 * The mode and the log live in the HOME that cli() passes, so fixtures stay independent.
 */
let ghBin: string | undefined;
/** Each test file that uses stubGh passes this to after(); the helper module cannot register it for them. */
export const cleanupGh = () => { if (ghBin) rmSync(dirname(ghBin), { recursive: true, force: true }); };
export function stubGh(home: string, mode: 'ok' | 'unauth' | 'noaccess' | 'duplicate'): string {
  writeFileSync(join(home, 'gh.mode'), mode);
  if (ghBin) return ghBin;
  const bin = join(processTemporaryDirectory('jstack-report-'), 'bin'); mkdirSync(bin, { recursive: true });
  const script = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'); const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.HOME, 'gh.log'), args.map(arg => arg + '\\x1f').join('') + '\\n');
const mode = fs.readFileSync(path.join(process.env.HOME, 'gh.mode'), 'utf8');
if (args[0] === '--version') { console.log('gh version 2.0.0'); process.exit(0); }
if (args[0] === 'auth') process.exit(mode === 'unauth' ? 1 : 0);
if (args[0] === 'repo') process.exit(mode === 'noaccess' ? 1 : 0);
if (args[0] === 'issue' && args[1] === 'list') { console.log(mode === 'duplicate' ? JSON.stringify([{ number: 7, title: 'x', url: 'https://example.invalid/issues/7' }]) : '[]'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'create') { console.log('https://example.invalid/issues/8'); process.exit(0); }
process.exit(0);
`;
  const sh = `#!/bin/sh
printf '%s\\037' "$@" >> "$HOME/gh.log"; printf '\\n' >> "$HOME/gh.log"
read -r mode < "$HOME/gh.mode"
case "$1" in
  --version) echo 'gh version 2.0.0'; exit 0;;
  auth) [ "$mode" = unauth ] && exit 1; exit 0;;
  repo) [ "$mode" = noaccess ] && exit 1; exit 0;;
esac
case "$1 $2" in
  "issue list") if [ "$mode" = duplicate ]; then echo '[{"number":7,"title":"x","url":"https://example.invalid/issues/7"}]'; else echo '[]'; fi; exit 0;;
  "issue create") echo https://example.invalid/issues/8; exit 0;;
esac
exit 0
`;
  // Windows resolves the npm-style launcher to the node script.
  writeFileSync(join(bin, 'gh'), process.platform === 'win32' ? script : sh); chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(bin, 'gh.js'), script.replace(/^#!.*\n/, ''));
  if (process.platform === 'win32') writeFileSync(join(bin, 'gh.cmd'), '@"%dp0%\\node.exe" "%dp0%\\gh.js" %*\r\n');
  return ghBin = bin;
}
/** Only the stub and Windows system PowerShell directories are searchable; no real gh CLI runs. */
function isolatedEnv(home: string, path: string): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = process.platform === 'win32' ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:path|claudecode|codex_.*|claude_.*)$/i.test(key))) : { TMPDIR: process.env.TMPDIR ?? tmpdir() };
  return { ...base, PATH: isolatedPath(path), HOME: home };
}
/** The real entry point in a child process: for the few tests that check exit codes and streams of the program itself. */
export function spawnCli(home: string, args: string[], path = join(home, 'empty-bin')) {
  mkdirSync(path, { recursive: true });
  const result = spawnSync(process.execPath, [MAIN, ...args, '--home', home], { encoding: 'utf8', env: isolatedEnv(home, path), timeout: 120000 });
  return { code: result.status, out: result.stdout, err: result.stderr };
}
/** main in this process with the environment spawnCli gives a child, so a behavior test pays no node start-up. */
export async function cli(home: string, args: string[], path = join(home, 'empty-bin')) {
  mkdirSync(path, { recursive: true });
  const out: string[] = [], err: string[] = [];
  const code = await main([...args, '--home', home], { stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) } }, isolatedEnv(home, path));
  return { code, out: out.join(''), err: err.join('') };
}
export const ghCalls = (home: string) => existsSync(join(home, 'gh.log')) ? readFileSync(join(home, 'gh.log'), 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('\x1f').slice(0, -1)) : [];
export function transcripts(home: string, at = new Date().toISOString(), old = '2020-01-01T00:00:00.000Z') {
  const claude = join(home, '.claude/projects/-work-project'); mkdirSync(claude, { recursive: true });
  const rows = [
    { type: 'user', timestamp: at, message: { content: [{ type: 'text', text: 'private conversation text that must never be captured' }] } },
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'jst disk status' } }] } },
    { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: `Exit code 1\nError: profile unreadable at ${home}/.jstack/profiles/disk-manager.json for someone@example.com` }] } },
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls /nowhere' } }] } },
    { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'ls: /nowhere: No such file or directory' }] } },
    { type: 'user', timestamp: old, message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Exit code 9\nold failure outside the window' }] } },
    { type: 'attachment', timestamp: at, attachment: { type: 'hook_non_blocking_error', hookName: 'PreToolUse:Edit', exitCode: '1', command: 'node "${CLAUDE_PLUGIN_ROOT}/payload/hooks/check_model_versions.js"', stderr: `Failed: token ${GH_TOKEN}` } },
    { type: 'attachment', timestamp: at, attachment: { type: 'hook_non_blocking_error', hookName: 'Stop', exitCode: '1', command: 'other-tool --stop', stderr: 'unrelated hook failure' } },
  ];
  writeFileSync(join(claude, 'session.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const codex = join(home, '.codex/sessions/2026/09/28'); mkdirSync(codex, { recursive: true });
  const codexRows = [
    { timestamp: at, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: 'jst report scan' }) } },
    { timestamp: at, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'Chunk ID: 1\nProcess exited with code 2\nOutput:\nError: Bearer abc.def-123 rejected' } },
    { timestamp: at, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c2', arguments: JSON.stringify({ cmd: 'jst disk status' }) } },
    { timestamp: at, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: 'Chunk ID: 2\nProcess exited with code 0\nOutput:\nok' } },
  ];
  writeFileSync(join(codex, 'rollout.jsonl'), codexRows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

/** A shortened line ends with an ellipsis after a whole word of its source. */
export function wholeWordPrefix(clipped: string, source: string, limit: number): void {
  assert.ok(clipped.length <= limit, `${clipped.length} > ${limit}: ${clipped}`);
  assert.ok(clipped.endsWith('…'), clipped);
  const kept = clipped.slice(0, -1);
  assert.ok(source.startsWith(kept), `${kept} is not a prefix of ${source}`);
  // Only trailing separators such as a colon may sit between the kept words and the next space.
  assert.match(source.slice(kept.length), /^[,;:(-]*\s/, `cut inside a word: ${clipped}`);
  assert.doesNotMatch(kept, /[\s,;:(-]$/);
}
export const LONG_FAILURE = 'while it read the Codex session index after the transcript directory moved, so every later retrospective stopped before it listed a single candidate from either host';
export async function drafted(home: string): Promise<{ id: string; draft: string }> {
  const noted = await cli(home, ['note', '--surface', 'jst report', '--text', `scan crashed in ${home}/.claude with ${GH_TOKEN} ${LONG_FAILURE}`, '--json']);
  assert.equal(noted.code, 0, noted.err);
  const note = JSON.parse(noted.out);
  const draft = await cli(home, ['draft', note.candidate.id, '--expected', 'The scan lists candidates', '--json']);
  assert.equal(draft.code, 0, draft.err);
  return JSON.parse(draft.out)[0];
}
/**
 * A draft written by hand for a recorded note, so a test that does not read the draft body needs no doctor run. It is
 * private state as `draft` writes it: chmod 0600 sets no Windows owner or ACL, so submit could not rewrite the file.
 */
export async function plainDraft(home: string, text: string): Promise<string> {
  const noted = await cli(home, ['note', '--surface', 'jst report', '--text', text, '--json']);
  assert.equal(noted.code, 0, noted.err);
  const { id, signature: sig } = JSON.parse(noted.out).candidate, file = join(roots(home).reports, 'drafts', `${id}.md`);
  atomicWrite(file, Buffer.from(`<!-- jstack-report id=${id} signature=${sig} -->\n\n## Summary\n\n${text}\n`), true, false);
  return file;
}
