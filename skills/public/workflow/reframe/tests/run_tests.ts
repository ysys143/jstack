/** Owning contracts for reframe: expert vocabulary is taught with confirmed citations and the request is rewritten. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_skill_body, check_total, split_frontmatter, type Result } from '../../../../_suite_lib.js';

const SUITE_FILE = fileURLToPath(import.meta.url), ROOT = dirname(dirname(SUITE_FILE)), SKILLS = dirname(ROOT);
const COMMIT = "b7b93c36be9bcc36a74db438e0fd385d660bc559";
const results: Result[] = [];
function check(name: string, ok: unknown, detail: unknown = ''): void { results.push([name, Boolean(ok), detail]); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail) : ''}`); }
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const flat = (text: string) => text.replace(/\s+/g, ' ');
const width = (text: string) => [...text].reduce((sum, char) => sum + (/[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1), 0);

const [fm, rawBody] = split_frontmatter(read(join(ROOT, 'SKILL.md')));
const skill = flat(rawBody), notice = read(join(ROOT, 'NOTICE')), noticeFlat = flat(notice);

const RULES: [string, string][] = [
  ["Purpose: teaches the expert words for what the user is building", "Teach the user the expert words for what they are building"],
  ["Purpose: starts from the user's own material, not a summary", "their own files, code, and description — not a summary"],
  ["Disambiguation: a vague description lists the two or three candidate problems", "list the two or three problems it could be first"],
  ["Disambiguation: each candidate carries the sign that tells it apart", "the sign that would tell it apart"],
  ["Disambiguation: the likeliest reading is picked with a reason", "say why you picked it"],
  ["Disambiguation: skipping it teaches precise words for the wrong problem", "precise words for the wrong problem"],
  ["Terms: 8 to 12 terms are taught", "8 to 12 terms"],
  ["Terms: ranked by how much each changes what gets built", "ranked by how much each would change what gets built"],
  ["Terms: each names a part of the user's description", "the part of their description it names"],
  ["Terms: each carries one real citation with a link", "one real project, paper, or system that uses it that way, with a link"],
  ["Terms: each says what it lets the user ask an agent for", "what it lets them ask an agent for"],
  ["Neighbors: 2 or 3 neighboring fields are borrowed from", "2 or 3 neighboring fields"],
  ["Neighbors: the breaking point of each analogy is stated", "where the analogy breaks"],
  ["Neighbors: the terms that come back are named", "which terms come back"],
  ["Omission: what the user did not mention is named", "what they did not mention"],
  ["Rewrite: the description is rewritten with the new words", "Rewrite their description"],
  ["Rewrite: the rewrite is the deliverable for the next step", "the deliverable they carry to the next step"],
  ["Citations: every link is opened and confirmed", "Open every link and confirm it uses the term that way"],
  ["Citations: unconfirmed citations are cut", "Cut any citation you cannot confirm"],
  ["Citations: no padding", "No padding"],
  ["Boundaries: grilling assumptions belongs to requirements-interview", "`requirements-interview`"],
  ["Boundaries: the spec belongs to plan", "`plan`"],
  ["Limits: the judgment of which problem is theirs stays with the user", "stays with the user"],
];
for (const [name, needle] of RULES) check(`SKILL.md ${name}`, skill.includes(needle), skill.includes(needle) ? '' : `missing: ${needle.slice(0, 60)}`);

const description = /^description:\s*"([^"]*)"/m.exec(fm)?.[1] ?? '';
check('Language: description follows "<sentence>. Triggers: <Korean triggers>."', /^[A-Z][^\n]*\. Triggers: [^\n]*[가-힣][^\n]*\.$/.test(description), description);
check('Language: description fits 100 display columns (a Korean character counts as two)', description.length > 0 && width(description) <= 100, `${width(description)} columns`);
check('Language: description names its Korean and English triggers', ["전문 용어", "reframe"].every((term: string) => description.includes(term)));

const FORBID: [string, string, string][] = [["no Cursor, pstack or Task-tool references", "\\.cursor|poteto|pstack|Task tool|readonly|subagent_type|unslop", ""], ["no model slugs", "\\b(opus|sonnet|haiku|grok|gpt)-?\\d?", "i"]];
for (const [name, pattern, flags] of FORBID) check(`Language: ${name}`, !new RegExp(pattern, flags).test(skill));

check('Boundaries: requirements-interview exists as a neighbor', existsSync(join(SKILLS, 'requirements-interview')));
check('Boundaries: plan exists as a neighbor', existsSync(join(SKILLS, 'plan')));

check('NOTICE: states the skill is adapted from pstack (MIT)', /is adapted from pstack \(MIT\)/.test(noticeFlat));
check('NOTICE: says it is a rewrite and not a pinned copy', /not a pinned copy/.test(noticeFlat));
check('NOTICE: pins the upstream commit', notice.includes(COMMIT));
check('NOTICE: names the upstream skill path', notice.includes('skills/reframe/SKILL.md'));
check('NOTICE: lists at least three changes', ((/## What changed\n([\s\S]*?)\n## /.exec(notice)?.[1] ?? '').match(/^- /gm) ?? []).length >= 3);
check('NOTICE: records the dropped disable-model-invocation field', notice.includes('disable-model-invocation'));
check('NOTICE: carries the MIT license text of the upstream author', notice.includes('Permission is hereby granted, free of charge') && notice.includes('Copyright (c) 2026 Lauren Tan'));
check('NOTICE: records what jstack added, including the tests', notice.includes('## Added by jstack') && notice.includes('`tests/`'));

const HEADS = ["Which problem is it", "The four moves", "Citations are checked, not suggested", "Boundaries", "Limits (stated)"];
const heads = [...rawBody.matchAll(/^## (.+)$/gm)].map(match => match[1]);
check('Skeleton: section headings preserve order', JSON.stringify(heads) === JSON.stringify(HEADS), String(heads));

check_skill_body(check, ROOT, { needles: ["Teach the user the expert words for what they are building", "Open every link and confirm it uses the term that way", "Rewrite their description"], floor: 1852 });
check_contract_coverage(check, SUITE_FILE, ROOT, { per_file: { "SKILL.md": 32, "NOTICE": 8 } });
check_body_deletion(check, SUITE_FILE, ROOT, { minimum: 32 });
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 54);
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} 통과`);
process.exitCode = passed === results.length ? 0 : 1;
