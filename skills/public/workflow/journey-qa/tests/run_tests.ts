/** Owning suite: the jstack entry contract, the pinned upstream copy, and upstream's own checks. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_contract_coverage, in_deleted_run } from '../../../../_suite_lib.js';
import { runUpstreamCheck } from './_upstream_check.js';

const file = fileURLToPath(import.meta.url), root = dirname(dirname(file)), upstream = join(root, 'repos', 'journey-qa');
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const contracts: Record<string, [string, RegExp][]> = {
  'SKILL.md': [
    ['sends the reader to the pinned upstream procedure', /Read `repos\/journey-qa\/SKILL\.md`/],
    ['upstream paths are relative to the pinned copy', /relative to `repos\/journey-qa\/` in this skill directory/],
    ['a gate that could not run is not a pass', /a gate that could not run is not a pass/],
    ['product adapters never live under the skill directory', /Never add one under this skill directory; a plugin update replaces it/],
    ['the pinned copy is not edited here', /Do not edit `repos\/journey-qa\/`\. A fix belongs upstream/],
    ['neighbouring skills own completion checks and UI review', /\| Check that a code change is complete \| `verify` \|[\s\S]*\| Accessibility or design review of a page \| `web-interface` \|/],
    ['irreversible steps stay with the user', /irreversible publication \(push, merge, export, filing an issue\) are the user's decisions[\s\S]*Stop and ask at each one/],
    ['credential files are never read or copied', /Do not read or copy credential files/],
    ['runs are kept out of Git before the first run', /git check-ignore -q \.journey-qa\/runs\/x[\s\S]*\.git\/info\/exclude/],
  ],
  'NOTICE': [
    ['records the upstream and its pinned commit', /github\.com\/ysys143\/journey-qa[\s\S]*Pinned commit \| [0-9a-f]{40} \|/],
    ['records the license and carries its text', /License \| MIT[\s\S]*Permission is hereby granted, free of charge/],
    ['states that no upstream file was modified', /No upstream file was modified/],
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
check('SKILL.md entry description names the Korean activation intent', typeof entryDescription === 'string' && ['온보딩 검증', '클린 설치'].every(term => (entryDescription as string).includes(term)));
check('SKILL.md is named journey-qa and its entry description is within 1024 characters', /^name: journey-qa$/m.test(entry) && typeof entryDescription === 'string' && entryDescription.length <= 1024);

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
check('the pinned copy leaves out measurement records', !existsSync(join(upstream, 'evals', 'results')));

// Upstream's own checks run only where the whole run can afford them: not in quick contracts, not in a body-deletion copy.
if (process.env.JSTACK_QUICK_CONTRACTS !== '1' && !in_deleted_run()) {
  // tmux reports its version with -V and rejects --version.
  for (const [tool, flag] of [['python3', '--version'], ['uv', '--version'], ['tesseract', '--version'], ['rsvg-convert', '--version'], ['tmux', '-V']] as const) check(`required tool ${tool} is available`, spawnSync(tool, [flag], { encoding: 'utf8' }).status === 0);
  const box = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-journey-qa-'));
  try {
    // A copy outside this repository. Upstream's repo self-scan lists files with `git ls-files`, and without a
    // repository that list is empty and the scan passes without looking, so the copy becomes its own repository.
    const copy = join(box, 'journey-qa');
    cpSync(upstream, copy, { recursive: true });
    for (const args of [['init', '-q'], ['add', '-A']]) spawnSync('git', args, { cwd: copy, encoding: 'utf8' });
    const tracked = (spawnSync('git', ['ls-files'], { cwd: copy, encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean).length;
    check('the copy is its own Git repository with every file tracked, so the upstream self-scan has input', tracked === tree.count, `${tracked}/${tree.count}`);
    // uv leaves lock files in its temporary directory, so give it one that goes away with the copy.
    const scratch = join(box, 'tmp');
    mkdirSync(scratch);
    // JQA_* variables name external adapters and a private denylist; a user's own values must not reach this check.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('JQA_')));
    const evidence = join(process.env.JSTACK_SUITE_EVIDENCE_DIR ?? mkdtempSync(join(realpathSync(tmpdir()), 'jstack-journey-evidence-')), 'journey-qa.details.json');
    const run = runUpstreamCheck(copy, { ...env, TMPDIR: scratch, TMP: scratch, TEMP: scratch }, evidence, tree);
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-6).join(' | ');
    check('upstream check.sh passes in a separate copy', run.status === 0 && !run.error, `details: ${evidence}` + (run.status === 0 && !run.error ? '' : `; exit ${run.status ?? run.signal}: ${run.error?.message ?? ''} ${tail}`));
  } finally { rmSync(box, { recursive: true, force: true }); }
}
check_contract_coverage(check, file, root, { per_file: { 'SKILL.md': 9, NOTICE: 4 } });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
