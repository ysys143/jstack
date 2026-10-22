/** Owning suite executes behavior fixtures against the delivered implementation. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check_contract_coverage } from '../../../../_suite_lib.js';
const file = fileURLToPath(import.meta.url), root = dirname(dirname(file));
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const contracts: Record<string, [string, RegExp][]> = {
  'SKILL.md': [
    ['never submits without approval of the exact draft', /Never submit without that approval/],
    ['a missing source is not "no problems"', /missing or unreadable source is a warning, not "no problems"/],
    ['offers once per signature per session', /Offer once per signature per session/],
    ['the proactive path never drafts or submits', /Never draft or submit from the proactive path/],
    ['records only when the user accepts the offer', /only\s+when the user accepts the offer[\s\S]*Silence or refusal\s+records nothing/],
    ['expected behavior is never invented', /Do not invent\s+expected behavior/],
    ['gh fallback gives the draft path', /Exit 3 means `gh` is missing[\s\S]*draft path/],
    ['a non-default repository warning reaches the user', /status\s+prints\s+a\s+WARNING[\s\S]*?tell\s+the\s+user\s+before\s+drafting/],
    ['an invalid configured repository goes back to the user', /Exit\s+2\s+because\s+the\s+configured\s+repository\s+is\s+invalid\s+means\s+nothing\s+was\s+sent;\s+ask\s+the\s+user\s+which\s+repository/],
    ['--repo only for a repository the user chose for one submission', /`--repo OWNER\/NAME` only when\s+the\s+user\s+chose\s+that\s+repository\s+for\s+this\s+one\s+submission/],
  ],
};
for (const [path, rules] of Object.entries(contracts)) {
  const content = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '';
  for (const [name, pattern] of rules) check(`${path} ${name}`, pattern.test(content));
}
// Each file is named so that a deleted or renamed test file fails here instead of shrinking the run.
const fixtures = ['report_units.test.js', 'report_state.test.js', 'report_submit.test.js'].map(name => join(dirname(file), name));
const present = fixtures.filter(path => existsSync(path));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...present], { encoding: 'utf8' });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error) console.error(result.error.message);
check('issue-report execution fixtures pass', present.length === fixtures.length && result.status === 0, present.length === fixtures.length ? '' : `missing ${fixtures.filter(path => !present.includes(path)).join(', ')}`);
check_contract_coverage(check, file, root, { per_file: { 'SKILL.md': 10 } });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
