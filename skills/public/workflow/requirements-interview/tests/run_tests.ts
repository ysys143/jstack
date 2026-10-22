/** Owning contracts for the interview skill: evidence first, one question per turn, a checkable stop condition, the spec as the record. */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_no_constant_assertions, check_total, check_skill_body, check_ref_contracts, split_frontmatter, check_body_deletion, check_contract_coverage, type Result } from '../../../../_suite_lib.js';
const SUITE_FILE = fileURLToPath(import.meta.url), ROOT = dirname(dirname(SUITE_FILE)), SKILLS = dirname(ROOT);
const results: Result[] = [];
function check(name: string, ok: unknown, detail: unknown = ''): void { results.push([name, Boolean(ok), detail]); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail) : ''}`); }
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const isdir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const section = (text: string, heading: string) => text.split(/^## /m).find(part => part.startsWith(heading)) ?? '';

const [fm, skill] = split_frontmatter(read(join(ROOT, 'SKILL.md')));
const evidence = section(skill, 'Read the evidence'), record = section(skill, 'Record'), stop = section(skill, 'Stop condition'), resume = section(skill, 'Resume');
const rules: [string, string, RegExp][] = [
  ['Evidence: reads the evidence before the first question', skill, /^## Read the evidence before asking anything$/m],
  ['Evidence: never asks what the code already answers', evidence, /Never ask what the code already answers/],
  ['Evidence: reads the task contract', evidence, /`\.jstack\/tasks\/<id>\/contract\.yaml`/],
  ['Evidence: picks the named task, else the only one, else asks', evidence, /Use the task the user named,\s+else the only task directory, else ask which one/],
  ['Evidence: task state comes from the verify workflow, not another store', evidence, /skills\/verify\/scripts\/workflow\.js" status <id>/],
  ['Evidence: reads status, diff stat and recent commits', evidence, /`git status --short`, `git diff --stat`[\s\S]*`git log --oneline -20`/],
  ['Evidence: the task contract is never edited', evidence, /Never edit `contract\.yaml`/],
  ['Evidence: shows what is settled before asking', evidence, /show what is already settled in at most three lines/],
  ['Contexts: no spec yet', skill, /\| \*\*No spec yet\*\* \|/],
  ['Contexts: mid-implementation', skill, /\| \*\*Mid-implementation\*\* \|/],
  ['Contexts: a named topic', skill, /\| \*\*Named topic\*\* \|/],
  ['Contexts: an unrelated diff is not mid-implementation', skill, /A diff in unrelated files does not make the work mid-implementation/],
  ['Contexts: mid-implementation questions cite their evidence', skill, /every question cites the evidence that raised it/],
  ['Limits: interview asks five questions per pass', skill, /\| \*\*interview\*\* \|[^\n]*\| 5 questions per pass \|/],
  ['Limits: grill makes eight challenges per pass', skill, /\| \*\*grill\*\* \|[^\n]*\| 8 challenges per pass \|/],
  ['Limits: each batched question counts', skill, /counts each question in it toward the\s+limit/],
  ['Discipline: one question per turn', skill, /\*\*One question per turn\.\*\*/],
  ['Discipline: AskUserQuestion when available, recommended option first', skill, /When `AskUserQuestion` is available[\s\S]{0,120}put the recommended option first/],
  ['Discipline: stops when the user says stop', skill, /Stop when the user says stop/],
  ['Stop: a checkable end instead of a score', stop, /ends when every open item has an answer or a recorded assumption\s+and every acceptance criterion is a verifiable sentence/],
  ['Stop: grill needs an outcome for every listed assumption', stop, /outcome for every listed assumption: held, changed, or dropped/],
  ['Stop: no numeric ambiguity score', stop, /Do not compute or display a numeric ambiguity score/],
  ['Stop: readiness report has a settled row', stop, /^settled\s+\|/m],
  ['Stop: readiness report has an assumed row', stop, /^assumed\s+\|/m],
  ['Stop: readiness report has an open row', stop, /^open\s+\|/m],
  ['Stop: offers the next step', stop, /End by offering the next step/],
  ['Record: appends to the spec and keeps no second log', record, /Append to `## Decisions` and `## Assumptions` in the spec; do not create a second\s+log/],
  ['Record: one status vocabulary', record, /`settled`, `open`, `assumed`, `held`, `changed`,\s+`dropped`/],
  ['Record: unanswered questions are recorded as open', record, /Record an unanswered question as `open` before ending/],
  ['Record: status changes never delete a line', record, /edit its status field and add the date;[\s\S]{0,40}`held`, also add `reason:`\. Never delete a line/],
  ['Record: questions go under Decisions, assumptions under Assumptions', record, /Questions and their answers go under\s+`## Decisions`; assumptions go under `## Assumptions`/],
  ['Stop: grill reports one outcome row per listed assumption', stop, /In grill mode, add one row per listed assumption with its outcome/],
  ['Record: templates carry a date placeholder, not a date', record, /^- <YYYY-MM-DD> \|/m],
  ['Record: does not invent a spec path', record, /When no spec exists, do not invent a path/],
  ['Resume: continues from the first open line', resume, /continue from the first line whose status is `open`/],
  ['Resume: the spec is the state', resume, /The spec is the state; there is no separate state file/],
  ['Modes: grill mode reads its reference', skill, /\(references\/grill-mode\.md\)/],
  ['Limits: the answers are the user\'s', skill, /The answers are the user's/],
];
for (const [name, text, pattern] of rules) check(`SKILL.md ${name}`, pattern.test(text));
for (const axis of ['Who uses it, and when', 'What happens without it', 'What are the boundaries', 'What if it fails', 'Who decides']) check(`Questions: asks "${axis}"`, skill.includes(`| **${axis}** |`));
check('Record: no fixed calendar date is left in the body', !/\b20\d\d-\d\d-\d\d\b/.test(skill));

const description = /description:\s*"([^"]*)"/.exec(fm)?.[1] ?? '';
check('Language: description is at most 1024 characters', description.length > 0 && description.length <= 1024, `${description.length} chars`);
check('Language: description names the trigger "인터뷰"', description.includes('인터뷰'));
check('Language: description names the grill path with "가정 공격" and "grill"', ['가정 공격', 'grill'].every(term => description.includes(term)));
check('Language: description does not claim refutation, which second-opinion owns', !/반박해줘|refute/.test(description));

const named = new Set([...skill.matchAll(/`([a-z][a-z-]{2,})` skill/g)].map(match => match[1]));
const missing = [...named].filter(name => !isdir(join(SKILLS, name)));
check('Boundary: names at least five other skills', named.size >= 5, [...named].sort().join(', '));
check('Boundary: every named skill exists', missing.length === 0, missing.join(', '));

check_ref_contracts(check, ROOT, [['grill-mode.md', 'grill mode: find assumptions, challenge, record an outcome', ['## Find the assumptions', 'in order of cost if wrong', 'What breaks this?', '| held |', '| changed |', '| dropped |', 'Do not edit code here', 'until the user says stop'], 1700]]);
check_skill_body(check, ROOT, { needles: ['Read the evidence before asking anything', 'One question per turn', 'Do not compute or display a numeric ambiguity score', 'The spec is the state'], floor: 5000 });
check_contract_coverage(check, SUITE_FILE, ROOT, { per_file: { 'SKILL.md': 52, 'references/grill-mode.md': 3 } });
check_body_deletion(check, SUITE_FILE, ROOT, { minimum: 52 });
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 68);
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} 통과`);
process.exitCode = passed === results.length ? 0 : 1;
