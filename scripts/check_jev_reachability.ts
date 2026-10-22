#!/usr/bin/env node
/** Exercise the checked package's real CLI boundaries with an in-process transport stub. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from '../runtime/entry.js';

interface Probe { code: number; output: string; requests: unknown[] }
const runner = `const requests = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init.body));
  requests.push(body);
  const choices = Object.keys(body.questions.decision.criteria);
  const other = choices.find(choice => choice !== process.env.JSTACK_TEST_TWIN) ?? choices[0];
  const probabilities = Object.fromEntries(choices.map(choice => [choice, 1 / choices.length]));
  return new Response(JSON.stringify({model:'jev-latest',usage:{input_tokens:1,output_tokens:1},answers:{decision:{type:'choice',choice:other,confidence:0.8,probabilities}}}));
};
const originalWrite = process.stdout.write.bind(process.stdout), originalLog = console.log, output = [];
process.stdout.write = chunk => { output.push(String(chunk)); return true; };
console.log = (...parts) => { output.push(parts.join(' ') + '\\n'); };
try {
  const { main } = await import(process.env.JSTACK_TEST_CLI_URL);
  const code = await main(JSON.parse(process.env.JSTACK_TEST_ARGS));
  process.stdout.write = originalWrite; console.log = originalLog;
  originalWrite(JSON.stringify({code,output:output.join(''),requests}) + '\\n');
} catch (error) {
  process.stdout.write = originalWrite; console.log = originalLog;
  originalWrite(JSON.stringify({error:String(error),requests}) + '\\n');
  process.exitCode = 2;
}`;

function probe(cliUrl: string, args: string[], twin: string, point: string | undefined, stateHome: string): Probe {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, JSTACK_JEV: point ?? 'off', TYPESAFE_API_KEY: 'fixture-key', XDG_STATE_HOME: stateHome,
      JSTACK_JEV_SESSION_ID: `probe-${point ?? 'off'}`, JSTACK_TEST_CLI_URL: cliUrl,
      JSTACK_TEST_ARGS: JSON.stringify(args), JSTACK_TEST_TWIN: twin },
  });
  if (child.status !== 0) throw new Error(`packaged CLI exited ${child.status}: ${child.stderr || child.stdout}`);
  let result: Probe;
  try { result = JSON.parse(child.stdout) as Probe; }
  catch { throw new Error(`packaged CLI emitted an invalid probe receipt: ${child.stdout}`); }
  if (result.code !== 0 || typeof result.output !== 'string' || !Array.isArray(result.requests)) throw new Error(`packaged CLI failed: ${child.stdout}`);
  return result;
}
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function assertOneRequest(receipt: Probe, point: string): void {
  expect(receipt.requests.length === 1, `${point}: packaged decision boundary did not reach exactly one transport call`);
}

export function checkJevReachability(packageRoot: string): { passed: true; points: string[]; disconnectionDetected: true } {
  const cliPath = resolve(packageRoot, 'cli/main.js');
  expect(existsSync(cliPath), `checked package CLI is missing: ${cliPath}`);
  const cliUrl = pathToFileURL(cliPath).href;
  const temp = mkdtempSync(join(tmpdir(), 'jstack-jev-reach-'));
  try {
    const git = spawnSync('git', ['init', '-q'], { cwd: temp, encoding: 'utf8' });
    expect(git.status === 0, `isolated Git init failed: ${git.stderr}`);
    writeFileSync(join(temp, 'pyproject.toml'), '[tool.ruff]\n');
    const candidate = (id: string) => ({ id, model: id, host: 'codex', transport: 'native', available: true, tools: ['Read'],
      access: ['read-only'], contextTokens: 32000, efforts: ['low', 'medium', 'high'], contextModes: ['fresh'], runtimeVersion: 'fixture' });
    const request = { schemaVersion: 1, taskId: 'fixture', kind: 'extract', prompt: 'private prompt must stay local', deliverable: 'Count',
      verification: 'Compare', cwd: temp, ownedFiles: [], access: 'read-only', tools: ['Read'], contextTokens: 1000,
      contextMode: 'fresh', impact: 'low', constraints: 'simple', delegationAllowed: true, allowedTransports: ['native'],
      candidates: [candidate('luna'), candidate('astra')], inheritedCandidate: 'luna', priority: ['luna', 'astra'], timeoutSeconds: 60 };
    const requestFile = join(temp, 'request.json'); writeFileSync(requestFile, JSON.stringify(request));
    const cases = [
      { point: 'model-routing', twin: 'luna', args: ['route', 'plan', '--request', requestFile], pick: (value: any) => value.selected?.id },
      { point: 'project-checks', twin: 'ask-user', args: ['project-hooks', 'recommend', '--cwd', temp, '--path', 'src/secret-path.py'], pick: (value: any) => value.recommendation },
      { point: 'task-size', twin: 'parallel', args: ['jev', 'task-size', '--decision', 'parallel', '--work-type', 'coding', '--impact', 'high',
        '--constraints', 'complex', '--changed-files', '3', '--independent-parts', '2', '--delegation-allowed', 'true', '--workspace', temp],
        pick: (value: any) => value.decision },
    ];
    for (const entry of cases) {
      const off = probe(cliUrl, entry.args, entry.twin, undefined, join(temp, 'state-off'));
      expect(off.requests.length === 0, `${entry.point}: key alone sent a request`);
      expect(entry.pick(JSON.parse(off.output)) === entry.twin, `${entry.point}: off decision differs from the emitted twin`);
      const shadow = probe(cliUrl, entry.args, entry.twin, entry.point, join(temp, `state-${entry.point}`));
      assertOneRequest(shadow, entry.point);
      expect(entry.pick(JSON.parse(shadow.output)) === entry.twin, `${entry.point}: shadow changed the emitted twin`);
      const body = shadow.requests[0] as Record<string, any>;
      expect(body?.model === 'jev-latest' && body?.state?.point === entry.point && body?.questions?.decision?.type === 'choice',
        `${entry.point}: request contract differs`);
      const text = JSON.stringify(body);
      expect(!text.includes(temp) && !text.includes('private prompt') && !text.includes('secret-path.py') && !text.includes('fixture-key'),
        `${entry.point}: private content escaped in the request`);
    }
    // Prove that this gate detects a packaged CLI which emits a plausible answer but never reaches Jev.
    const disconnected = join(temp, 'disconnected.mjs');
    writeFileSync(disconnected, 'export async function main(){process.stdout.write(JSON.stringify({decision:"parallel"}));return 0;}\n');
    const noCall = probe(pathToFileURL(disconnected).href, cases[2]!.args, 'parallel', 'task-size', join(temp, 'state-disconnected'));
    expect(noCall.requests.length === 0, 'disconnected fixture unexpectedly reached Jev');
    let detected = false;
    try { assertOneRequest(noCall, 'task-size'); }
    catch { detected = true; }
    expect(detected, 'disconnected recorder was not detected');
    return { passed: true, points: cases.map(entry => entry.point), disconnectionDetected: true };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.length !== 2 || argv[0] !== '--package') throw new Error('Usage: check_jev_reachability --package PACKAGE_PAYLOAD_ROOT');
  console.log(JSON.stringify(checkJevReachability(argv[1]!)));
  return 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 2; } }
