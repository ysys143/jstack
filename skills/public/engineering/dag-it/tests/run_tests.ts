/** Owning suite: the jstack entry contract, the pinned upstream copy, and upstream's own template check. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_contract_coverage, in_deleted_run } from '../../../../_suite_lib.js';

const file = fileURLToPath(import.meta.url), root = dirname(dirname(file)), upstream = join(root, 'repos', 'just-dag-it');
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const contracts: Record<string, [string, RegExp][]> = {
  'SKILL.md': [
    ['sends the reader to the pinned upstream procedure', /Read `repos\/just-dag-it\/skills\/dag-it\/SKILL\.md`/],
    ['upstream paths are relative to the pinned copy', /relative to `repos\/just-dag-it\/skills\/dag-it\/` in this skill directory/],
    ['a check that could not run is not a pass', /a check that could not run is not a pass/],
    ['a DAG is not the default rung', /say so and stop; a DAG is not the default/],
    ['a project DAG never lives under the skill directory', /Never build a project's DAG under this skill directory; a plugin update replaces it/],
    ['the pinned copy is not edited here', /Do not edit `repos\/just-dag-it\/`\. A fix belongs upstream/],
    ['neighbouring skills own completion checks and tests', /\| Check that a code change is complete \| `verify` \|[\s\S]*\| Write the tests for a feature \| `test-driven-development` \|/],
    ['running, scheduled and automatic-agent steps stay with the user', /starting the full sweep, turning a schedule on, starting the daemon as a service, and configuring `DIAGNOSE_COMMAND` or `REPORT_COMMAND` are the user's decisions[\s\S]*Stop and ask at each one/],
    ['automatic diagnosis uses a subscription runtime and changes nothing', /never configure one that bills an API key unless the user names that path\. No automatically called agent may rerun or change anything\./],
  ],
  'NOTICE': [
    ['records the upstream and its pinned commit', /github\.com\/ysys143\/just-dag-it[\s\S]*Pinned commit \| [0-9a-f]{40} \|/],
    ['records the license and carries its text', /License \| MIT[\s\S]*Permission is hereby granted, free of charge/],
    ['states that no upstream file was modified', /No upstream file was modified/],
    ['records the Apache-2.0 dagster-expert material inside the copy', /dagster-io\/skills[\s\S]*ed0248b1b6b70710a8785e3ff4880b44496c0f94[\s\S]*Apache License, Version 2\.0/],
  ],
};
for (const [path, rules] of Object.entries(contracts)) {
  const content = read(join(root, path));
  for (const [name, pattern] of rules) check(`${path} ${name}`, pattern.test(content));
}

// The entry carries a short routing description for the host listing budget; the pinned upstream description stays untouched in the copy.
const entry = read(join(root, 'SKILL.md'));
const descriptionLine = (text: string) => /^description: (.*)$/m.exec(text)?.[1];
let entryDescription: unknown;
try { entryDescription = JSON.parse(descriptionLine(entry) ?? ''); } catch { entryDescription = undefined; }
check('SKILL.md entry description names the Korean activation intent', typeof entryDescription === 'string' && ['실험 자동화', '반복 실행'].every(term => (entryDescription as string).includes(term)));
check('SKILL.md is named dag-it and its entry description is within 1024 characters', /^name: dag-it$/m.test(entry) && typeof entryDescription === 'string' && entryDescription.length <= 1024);

// Tree identity: the copy is exactly what NOTICE records.
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(join(dir, item.name)) : [join(dir, item.name)]);
function treeDigest(dir: string): { digest: string; count: number } {
  const rows = existsSync(dir) ? files(dir).map(path => relative(dir, path).split(sep).join('/')).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))) : [];
  const hash = createHash('sha256');
  for (const rel of rows) hash.update(`${rel}\0${createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')}\n`);
  return { digest: hash.digest('hex'), count: rows.length };
}
const notice = read(join(root, 'NOTICE')), tree = treeDigest(upstream);
check('NOTICE records the digest and file count of the pinned copy', notice.includes(`| Tree digest (sha256) | ${tree.digest} |`) && notice.includes(`| Files | ${tree.count} |`), `${tree.count} files ${tree.digest.slice(0, 12)}`);
check('the pinned copy leaves out the upstream plugin manifests', !existsSync(join(upstream, '.claude-plugin')));
check('the pinned copy keeps the upstream skill, template and consumer-boundary reference', ['skills/dag-it/SKILL.md', 'skills/dag-it/references/template/definitions.py', 'skills/dag-it/references/consumer-boundaries.md', 'tests/test_template.py'].every(rel => existsSync(join(upstream, rel))));

// Upstream's own template check runs only where the whole run can afford it: not in quick contracts, not in a body-deletion copy.
if (process.env.JSTACK_QUICK_CONTRACTS !== '1' && !in_deleted_run()) {
  check('required tool uv is available', spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0);
  const box = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-dag-it-'));
  try {
    // A copy outside this repository, so the template's results and escalations never land in the source tree.
    const copy = join(box, 'just-dag-it'), scratch = join(box, 'tmp');
    cpSync(upstream, copy, { recursive: true });
    mkdirSync(scratch);
    // A user's own diagnosis or report command must not reach this check; the upstream test sets its own stand-ins.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['DIAGNOSE_COMMAND', 'REPORT_COMMAND', 'DIAGNOSE_TIMEOUT', 'DAGSTER_HOME'].includes(key)));
    const args = ['run', '--quiet', '--python', '3.13', '--with', 'dagster==1.13.26', 'python', 'tests/test_template.py'];
    const run = spawnSync('uv', args, { cwd: copy, env: { ...env, TMPDIR: scratch, TMP: scratch, TEMP: scratch }, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    const evidence = join(process.env.JSTACK_SUITE_EVIDENCE_DIR ?? mkdtempSync(join(realpathSync(tmpdir()), 'jstack-dag-it-evidence-')), 'dag-it.details.json');
    mkdirSync(dirname(evidence), { recursive: true });
    writeFileSync(evidence, JSON.stringify({ schemaVersion: 1, command: ['uv', ...args], upstream: tree, exitCode: run.status, signal: run.signal, error: run.error?.message ?? null, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }, null, 1));
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ');
    check('upstream template check passes in a separate copy', run.status === 0 && !run.error, `details: ${evidence}` + (run.status === 0 && !run.error ? '' : `; exit ${run.status ?? run.signal}: ${run.error?.message ?? ''} ${tail}`));
  } finally { rmSync(box, { recursive: true, force: true }); }
}
check_contract_coverage(check, file, root, { per_file: { 'SKILL.md': 9, NOTICE: 5 } });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
