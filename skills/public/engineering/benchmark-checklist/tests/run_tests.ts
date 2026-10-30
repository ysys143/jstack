/** Owning contracts for benchmark-checklist: a performance number is vetted with seven evidence questions before it is reported or acted on. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_ref_contracts, check_skill_body, check_total, split_frontmatter, type Result } from '../../../../_suite_lib.js';

const SUITE_FILE = fileURLToPath(import.meta.url), ROOT = dirname(dirname(SUITE_FILE)), SKILLS = dirname(dirname(dirname(ROOT)));
const COMMIT = "4dd1d05818d19792e7cd6e818f1667f95f7e1dbe";
const results: Result[] = [];
function check(name: string, ok: unknown, detail: unknown = ''): void { results.push([name, Boolean(ok), detail]); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail) : ''}`); }
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const flat = (text: string) => text.replace(/\s+/g, ' ');
const width = (text: string) => [...text].reduce((sum, char) => sum + (/[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1), 0);

const [fm, rawBody] = split_frontmatter(read(join(ROOT, 'SKILL.md')));
const skill = flat(rawBody), notice = read(join(ROOT, 'NOTICE')), noticeFlat = flat(notice);

const RULES: [string, string][] = [["Decide: write the claim in the words you would ship", "Write the claim you expect to make, in the words you would ship"], ["Decide: name the result that would change a decision and the noise floor", "Name the result that would change a decision, and the noise floor."], ["Decide: stop when the spread exceeds that result", "If the run-to-run spread is larger than that result, stop and fix the measurement"], ["Decide: read what the script times, counts and ignores", "Note what it times, what it counts, and what it ignores."], ["Decide: read the load average and core count", "Read the load average (`uptime`) and the core count"], ["Decide: interleave the sides when the machine is busy and say so", "interleave the sides so both see the same noise, and say so in the report"], ["Ballpark: one run is enough but questions 4 and 7 still apply", "one run is enough. Still answer questions 4 and 7, and say it was one run."], ["Ballpark: a choice between options is never a ballpark", "A choice between options is never a ballpark."], ["Question 1: profile in a run you do not report", "recorded in a run you do not report, because profilers and tracers slow the work"], ["Question 1: a saturated load generator means you measured the load generator", "you measured the load generator"], ["Question 1: the limiter explains a number that did not move", "the limiter says why, so find it before you call the change useless"], ["Question 2: a side on defaults is a configuration comparison", "you compared configurations, not implementations"], ["Question 2: an untuned side that cannot be tuned names no winner", "name no winner from that run"], ["Question 2: narrowing the claim does not repair an adoption choice", "does not repair this, because they adopt the option along with its tuning"], ["Question 3: removing a 10% piece is at most about 11% faster", "Removing a piece that is 10% of the run makes the run at most about 11% faster."], ["Question 3: a result beyond a limit measured something other than the work", "measured something other than the work: a cache, a no-op, or a bug"], ["Question 4: count failures and check that outputs are correct", "Count failures and non-success responses, and check that the outputs are correct, not only present."], ["Question 5: at least five alternating runs per side", "Run each side at least 5 times, alternating (A, B, A, B)"], ["Question 5: a gap inside the spread is no measurable difference", "A gap smaller than the run-to-run spread is no measurable difference."], ["Question 6: the micro result is a share of the end-to-end path", "give the micro result as a share of that whole"], ["Question 7: confirm the work ran inside the timed region", "Confirm the work ran inside the timed region"], ["Eval results: ask the same of the trials", "did every run attempt the task, does the gap hold across trials and across models"], ["Report: lead with the verdict", "Lead with the verdict: faster, slower, no measurable difference, or inconclusive."], ["Report: number with unit, run count, range and limiter", "Give the number with its unit, the run count, the range, and the limiter."], ["Report: the conditions that make a verdict inconclusive", "Call the verdict **inconclusive** when you claim a difference but cannot name the limiter, when a side ran untuned, or when you could not check questions 4 and 7."], ["Report: a PR body carries one primary number", "Keep a PR body to one primary number."], ["Harness: print the error count and the work count", "make it print its error count and a count of the work it actually did"], ["Harness: the verify skill's validation-cost reference", "as the `verify` skill's validation-cost reference asks"], ["Boundary: React rules belong to react-performance", "| Rules for faster React and Next.js code | `react` skill |"], ["Boundary: slow validation belongs to verify", "| Slow validation, CI setup cost, or whether to keep a validation change | `verify` skill |"], ["Boundary: completeness belongs to verify", "| Deciding whether finished work is complete | `verify` skill |"], ["Boundary: react-performance measurements run through this checklist", "run this checklist on that measurement"], ["Limits: names gaps and does not make a number true", "This skill names the gaps in a measurement. It does not make a number true"], ["Limits: an unanswerable question leaves the verdict inconclusive", "A question that cannot be answered here is reported as unanswered, and the verdict is inconclusive"], ["Questions: question 1 is why not double?", "1. **Why not double?**"], ["Questions: question 2 is was it tuned?", "2. **Was it tuned?**"], ["Questions: question 3 is did it break limits?", "3. **Did it break limits?**"], ["Questions: question 4 is did it error?", "4. **Did it error?**"], ["Questions: question 5 is does it reproduce?", "5. **Does it reproduce?**"], ["Questions: question 6 is does it matter?", "6. **Does it matter?**"], ["Questions: question 7 is did it even happen?", "7. **Did it even happen?**"]];
for (const [name, needle] of RULES) check(`SKILL.md ${name}`, skill.includes(needle), skill.includes(needle) ? '' : `missing: ${needle.slice(0, 60)}`);

const description = /^description:\s*"([^"]*)"/m.exec(fm)?.[1] ?? '';
check('Language: description follows "<sentence>. Triggers: <Korean triggers>."', /^[A-Z][^\n]*\. Triggers: [^\n]*[가-힣][^\n]*\.$/.test(description), description);
check('Language: description fits 100 display columns (a Korean character counts as two)', description.length > 0 && width(description) <= 100, `${width(description)} columns`);
check('Language: description names its Korean and file triggers', ["벤치마크", "성능 수치"].every((term: string) => description.includes(term)));


const prose = flat([rawBody, ...[].map((file: string) => read(join(ROOT, 'references', file)))].join(' '));
const FORBID: [string, string, string][] = [["no Cursor or pstack playbook references", "\\.cursor|poteto|playbook|pstack|Hillclimb", ""], ["no model slugs", "\\b(opus|sonnet|haiku|grok|gpt)-?\\d?", "i"]];
for (const [name, pattern, flags] of FORBID) check(`Language: ${name}`, !new RegExp(pattern, flags).test(prose));

check('NOTICE: states the skill is adapted from pstack (MIT)', /is adapted from pstack \(MIT\)/.test(noticeFlat));
check('NOTICE: pins the upstream commit', notice.includes(COMMIT));
check('NOTICE: says it is a rewrite and not a pinned copy', /not a pinned copy/.test(noticeFlat));
check('NOTICE: lists at least three changes', ((/## What changed\n([\s\S]*?)\n## /.exec(notice)?.[1] ?? '').match(/^- /gm) ?? []).length >= 3);
check('NOTICE: carries the MIT license text of the upstream author', notice.includes('Permission is hereby granted, free of charge') && notice.includes('Copyright (c) 2026 Lauren Tan'));
check('NOTICE: records what jstack added, including the tests', notice.includes('## Added by jstack') && notice.includes('`tests/`'));
const NOTICE_EXTRA: [string, string][] = [["NOTICE: names the absorbed principle skill", "skills/principle-explain-the-number/SKILL.md"], ["NOTICE: names the upstream skill path", "skills/benchmark-checklist/SKILL.md"]];
for (const [name, needle] of NOTICE_EXTRA) check(name, notice.includes(needle), notice.includes(needle) ? '' : `missing: ${needle}`);

check_skill_body(check, ROOT, { needles: ["Decide before you run", "The seven questions", "Call the verdict **inconclusive**", "Did it even happen?"], floor: 3900 });
check_contract_coverage(check, SUITE_FILE, ROOT, { per_file: {"SKILL.md": 49, "NOTICE": 8} });
check_body_deletion(check, SUITE_FILE, ROOT, { minimum: 49 });
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 69);
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} 통과`);
process.exitCode = passed === results.length ? 0 : 1;
