import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check_body_deletion, check_contract_coverage, check_total, check_no_constant_assertions, type Result } from '../../../../_suite_lib.js';
const suite = fileURLToPath(import.meta.url), root = dirname(dirname(suite)), plugin = join(root, '../..');
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok]); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const read = (name: string) => existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : '';
const body = read('SKILL.md');
for (const [name, rule] of [
  ['explicit selection', /general build request[\s\S]*does not select it/],
  ['latent requirements', /current estimate of intent/],
  ['material uncertainty', /expensive-to-reverse decision/],
  ['question limits', /neither means ready/],
  ['old spec reuse', /not a repeated interview/],
  ['separate projections', /checks-passed, review-approved and accepted separately/],
  ['immutable contracts', /never edit its immutable contract.yaml/],
  ['unknown effects', /Read back unknown external outcomes before retrying/],
  ['noninterference', /Standalone and external leaf calls keep their existing inputs/],
  ['reentry', /Never pick a global\nlatest run/],
  ['use_when token', /<Use_When>[\s\S]*`jstack:sdlc`, `\/sdlc`, `\$sdlc`, `\/jstack:sdlc`,[\s\S]*<\/Use_When>/],
  ['use_when confirmation', /<Use_When>[\s\S]*ask the user whether to start an SDLC[\s\S]*requirementsSha256[\s\S]*<\/Use_When>/],
  ['do_not_use_when', /<Do_Not_Use_When>[\s\S]*sdlc name appears only in other text[\s\S]*<\/Do_Not_Use_When>/],
  ['offer once, never starts', /<Offer_When>[\s\S]*Offer once per task[\s\S]*The offer never starts a run[\s\S]*<\/Offer_When>/],
] as const) check(`SDLC: ${name}`, rule.test(body));
check('Run protocol: event identity and no implicit resume', /current revision, run, coordinator and epoch/.test(read('references/run-protocol.md')) && /never executes/.test(read('references/run-protocol.md')));
check('Release: readback and post-commit freshness', /Run verify again for the new HEAD/.test(read('references/release.md')) && /do not retry/.test(read('references/release.md')));
for (const name of ['sdlc.test.js', 'sdlc-release.test.js', 'sdlc-ship.test.js', 'sdlc_effects.test.js']) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const out = spawnSync(process.execPath, ['--test', join(plugin, 'runtime', name)], { encoding: 'utf8', timeout: 120000, env });
  check(`Runtime behavior: ${name}`, out.status === 0 && /(?:pass [1-9]|# pass [1-9])/.test(out.stdout), out.status === 0 ? '' : out.stdout + out.stderr);
}
check_contract_coverage(check, suite, root, { per_file: { 'SKILL.md': 14, 'references/run-protocol.md': 1, 'references/release.md': 1 } });
check_body_deletion(check, suite, root, { minimum: 14 });
check_no_constant_assertions(check, suite);
check_total(check, results, 28);
console.log(`\n${results.filter(([, ok]) => ok).length}/${results.length} 통과`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
