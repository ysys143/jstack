/** Owning suite: the jstack entry contract and the pinned upstream copy (upstream ships no tests for this skill). */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_contract_coverage } from '../../../../_suite_lib.js';

const file = fileURLToPath(import.meta.url), root = dirname(dirname(file));
const copyRoot = join(root, 'repos', 'pstack'), skill = join(copyRoot, 'skills', 'create-formal-verification-skill');
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const contracts: Record<string, [string, RegExp][]> = {
  'SKILL.md': [
    ['sends the reader to the pinned upstream procedure', /Read `repos\/pstack\/skills\/create-formal-verification-skill\/SKILL\.md`/],
    ['maps the pstack /statechart skill to the jstack statechart skill by name only', /use the jstack `statechart` skill\. Refer to it by name in the generated skill, as upstream says; copy none of its commands, options or paths\./],
    ['a check that could not run is not a pass', /instead of skipping the proof step; a check that could not run is not a pass/],
    ['the generated skill never lives under this skill directory', /Never write them under this skill directory; a plugin update replaces it/],
    ['the pinned copy is not edited here', /Do not edit `repos\/pstack\/`\. A fix belongs upstream/],
    ['neighbouring skills own chart reading, completion and tests', /\| Read a TLA\+ result as shortest bug paths and a statechart \| `statechart` \|[\s\S]*\| Check that a code change is complete \| `verify` \|/],
    ['tool installs and product code changes stay with the user, and findings stay findings', /Installing a verification tool and changing product code are the user's decisions[\s\S]*Findings stay findings/],
  ],
  'NOTICE': [
    ['records the upstream and its pinned commit', /github\.com\/cursor\/plugins[\s\S]*Pinned commit \| [0-9a-f]{40} \|/],
    ['records the license and carries its text', /License \| MIT[\s\S]*Permission is hereby granted, free of charge/],
    ['states that no upstream file was modified', /No upstream file was modified/],
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
check('SKILL.md entry description names the Korean activation intent', typeof entryDescription === 'string' && ['형식 검증', '모델 검사'].every(term => (entryDescription as string).includes(term)));
check('SKILL.md is named create-formal-verification-skill and its entry description is within 1024 characters', /^name: create-formal-verification-skill$/m.test(entry) && typeof entryDescription === 'string' && entryDescription.length <= 1024);

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
check('the pinned copy holds the upstream skill and the pstack license', existsSync(join(skill, 'SKILL.md')) && existsSync(join(copyRoot, 'LICENSE')));
check_contract_coverage(check, file, root, { per_file: { 'SKILL.md': 7, NOTICE: 3 } });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
