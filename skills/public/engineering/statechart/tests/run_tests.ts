/** Owning suite: the jstack entry contract, the pinned upstream copy, and upstream's own tests with TLC. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_contract_coverage, in_deleted_run } from '../../../../_suite_lib.js';

const file = fileURLToPath(import.meta.url), root = dirname(dirname(file));
const copyRoot = join(root, 'repos', 'pstack'), skill = join(copyRoot, 'skills', 'statechart');
const TLC_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const contracts: Record<string, [string, RegExp][]> = {
  'SKILL.md': [
    ['sends the reader to the pinned upstream procedure', /Read `repos\/pstack\/skills\/statechart\/SKILL\.md`/],
    ['upstream paths and <skill dir> resolve to the pinned copy', /relative to `repos\/pstack\/skills\/statechart\/` in this skill directory, and `<skill dir>` in its commands is that directory/],
    ['names the TypeScript-capable runtimes and that jstack needs only Node 20', /Node 22\.18 to 22\.x, Node 23\.6 or later, Bun 1\.1\.5 or later, or Deno 2\.0 or later[\s\S]*jstack itself needs only Node 20/],
    ['a check that could not run is not a pass', /instead of drawing a chart by hand; a check that could not run is not a pass/],
    ['the first-run mise install waits for the user', /first-run install of Java and TLC 1\.7\.4 with mise over the network\. Ask the user before that install\./],
    ['specs and views never live under the skill directory', /Never write them under this skill directory; a plugin update replaces it/],
    ['the pinned copy is not edited here', /Do not edit `repos\/pstack\/`\. A fix belongs upstream/],
    ['Pele is an installation that waits for the user, and other diagrams stay with svg-diagram', /installing Pele is an installation, so ask the user first\. Other diagrams stay with `svg-diagram`\./],
    ['bug paths are replayed against real code before they are reported', /replay each bug path against the real code as upstream requires before reporting it as a bug/],
  ],
  'NOTICE': [
    ['records the upstream and its pinned commit', /github\.com\/cursor\/plugins[\s\S]*Pinned commit \| [0-9a-f]{40} \|/],
    ['records the license and carries its text', /License \| MIT[\s\S]*Permission is hereby granted, free of charge/],
    ['states that no upstream file was modified', /No upstream file was modified/],
    ['records the TLC pin and the locked test environment', /tla2tools\.jar[\s\S]*936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88[\s\S]*tests\/environment/],
  ],
};
for (const [path, rules] of Object.entries(contracts)) {
  const content = read(join(root, path));
  for (const [name, pattern] of rules) check(`${path} ${name}`, pattern.test(content));
}

const entry = read(join(root, 'SKILL.md'));
const descriptionLine = (text: string) => /^description: (.*)$/m.exec(text)?.[1];
let entryDescription: unknown;
try { entryDescription = JSON.parse(descriptionLine(entry) ?? ''); } catch { entryDescription = undefined; }
check('SKILL.md entry description names the Korean activation intent', typeof entryDescription === 'string' && ['상태도', 'TLA+'].every(term => (entryDescription as string).includes(term)));
check('SKILL.md is named statechart and its entry description is within 1024 characters', /^name: statechart$/m.test(entry) && typeof entryDescription === 'string' && entryDescription.length <= 1024);

// Tree identity: the copy is exactly what NOTICE records.
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(join(dir, item.name)) : [join(dir, item.name)]);
function treeDigest(dir: string): { digest: string; count: number } {
  const rows = existsSync(dir) ? files(dir).map(path => relative(dir, path).split(sep).join('/')).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))) : [];
  const hash = createHash('sha256');
  for (const rel of rows) hash.update(`${rel}\0${createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')}\n`);
  return { digest: hash.digest('hex'), count: rows.length };
}
const notice = read(join(root, 'NOTICE')), tree = treeDigest(copyRoot);
check('NOTICE records the digest and file count of the pinned copy', notice.includes(`| Tree digest (sha256) | ${tree.digest} |`) && notice.includes(`| Files | ${tree.count} |`), `${tree.count} files ${tree.digest.slice(0, 12)}`);
const launcher = join(skill, 'scripts', 'statechart');
check('the upstream launcher stays executable', existsSync(launcher) && (statSync(launcher).mode & 0o111) !== 0);
const lock = read(join(root, 'tests', 'environment', 'package-lock.json'));
check('the locked test environment pins the fast-check version upstream declares', /"node_modules\/fast-check": \{\s*"version": "4\.5\.3"/.test(lock) && /"fast-check": "4\.5\.3"/.test(read(join(skill, 'scripts', 'package.json'))));

// A runtime that executes TypeScript directly, as the upstream launcher requires.
const typescriptNode = (candidate: string | undefined) => {
  if (!candidate) return false;
  const run = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  const [major = 0, minor = 0] = (/^v(\d+)\.(\d+)/.exec(run.stdout ?? '') ?? []).slice(1).map(Number);
  return run.status === 0 && ((major === 22 && minor >= 18) || (major === 23 && minor >= 6) || major > 23);
};

// Upstream's own tests run only where the whole run can afford them: not in quick contracts, not in a body-deletion copy.
if (process.env.JSTACK_QUICK_CONTRACTS !== '1' && !in_deleted_run()) {
  const node = [process.env.JSTACK_STATECHART_NODE, process.execPath].find(typescriptNode);
  check('a Node that runs TypeScript directly is available (JSTACK_STATECHART_NODE or this Node)', node);
  const jar = process.env.TLA2TOOLS ?? '', java = process.env.JAVA || 'java';
  check('TLA2TOOLS names tla2tools.jar 1.7.4 with the pinned sha256', existsSync(jar) && createHash('sha256').update(readFileSync(jar)).digest('hex') === TLC_SHA256, jar || 'TLA2TOOLS is unset');
  check('Java runs for TLC', spawnSync(java, ['-version'], { encoding: 'utf8' }).status === 0, java);
  const dependencies = process.env.JSTACK_STATECHART_DEPENDENCIES ?? '';
  check('the disposable locked test environment is installed', existsSync(join(dependencies, 'fast-check', 'package.json')), dependencies || 'JSTACK_STATECHART_DEPENDENCIES is unset');
  if (node && existsSync(jar) && existsSync(join(dependencies, 'fast-check', 'package.json'))) {
    // Upstream's symlink test computes relative links from os.tmpdir(), so the temporary folder must be a real path.
    const box = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-statechart-'));
    try {
      const copy = join(box, 'statechart'), scratch = join(box, 'tmp');
      cpSync(skill, copy, { recursive: true });
      mkdirSync(scratch);
      symlinkSync(dependencies, join(copy, 'scripts', 'node_modules'), 'dir');
      const tests = readdirSync(join(copy, 'scripts', 'test')).filter(name => name.endsWith('.test.ts')).sort().map(name => join('test', name));
      const env = { ...process.env, PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}`, TMPDIR: scratch + sep, TMP: scratch, TEMP: scratch, TLA2TOOLS: jar, JAVA: java };
      const args = ['--disable-warning=ExperimentalWarning', '--test', ...tests];
      const run = spawnSync(node, args, { cwd: join(copy, 'scripts'), env, encoding: 'utf8', timeout: 1_200_000, maxBuffer: 256 * 1024 * 1024 });
      const out = `${run.stdout ?? ''}${run.stderr ?? ''}`, count = (key: string) => Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(out)?.[1] ?? NaN);
      const tally = { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') };
      const evidence = join(process.env.JSTACK_SUITE_EVIDENCE_DIR ?? mkdtempSync(join(realpathSync(tmpdir()), 'jstack-statechart-evidence-')), 'statechart.details.json');
      mkdirSync(dirname(evidence), { recursive: true });
      writeFileSync(evidence, JSON.stringify({ schemaVersion: 1, command: [node, ...args], upstream: tree, tally, exitCode: run.status, signal: run.signal, error: run.error?.message ?? null, output: out }, null, 1));
      check('upstream tests pass with TLC, none skipped', run.status === 0 && !run.error && tally.fail === 0 && tally.skipped === 0 && tally.tests > 0 && tally.pass === tally.tests, `${JSON.stringify(tally)}; details: ${evidence}`);
    } finally { rmSync(box, { recursive: true, force: true }); }
  }
}
check_contract_coverage(check, file, root, { per_file: { 'SKILL.md': 9, NOTICE: 4 } });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
