/** Owning contracts for maintain-verification-skill: a project-local verification skill is audited against the app and edited only with approval. */
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

const RULES: [string, string][] = [["Outcomes: clean means no edit and no branch", "- **clean:** every feature got source coverage and a live drive"], ["Outcomes: changed means proven corrections", "- **changed:** proven corrections to the docs, the harness, or the map are made."], ["Outcomes: blocked says exactly what blocked it", "Say exactly what blocked it."], ["Scope: edit only the verification skill's own folder", "Edit only the verification skill's own folder"], ["Scope: name the folder and the files, then wait for approval", "**wait for the user's approval before the first edit**"], ["Scope: reading, the source wave and live drives change no tracked file", "Reading, the source wave, and live drives change no tracked file."], ["Scope: a mid-pass fix asks for the same approval first", "asks for the same approval first"], ["Scope: product code is never edited in this pass", "Never edit product code in this pass."], ["Scope: drift is fixed in the map and a regression is reported", "documentation drift, which you fix in the map, or a product regression, which you report"], ["Pass 0: with no target, point to create-verification-skill", "point to `create-verification-skill`"], ["Pass 0: do not invent a target", "Do not invent a target."], ["Pass 1: no generated inventory", "do not generate an inventory"], ["Pass 2: readers run concurrently under parallel-execution", "run concurrently under `parallel-execution`"], ["Pass 2: readers never drive the app and never edit", "Readers never drive the app and never edit files."], ["Pass 2: drift is flagged with file and line citations", "flags likely drift with file and line citations"], ["Pass 2: the tier follows model-selection with a stated reason", "Pick the tier by `model-selection` and say why"], ["Pass 2: a reader that changed a file is a defect", "a reader that changed a file is a defect to report"], ["Pass 3: a feature with no result is a gap, not a pass", "A feature with no result is a gap, not a pass"], ["Pass 3: a missing surface needs a concrete source path", "call one missing only with a concrete source path"], ["Pass 4: the live pass is required even when the source looks clean", "Required even when the source looks clean."], ["Pass 4: the verification skill's own launch model decides", "follow the verification skill's own launch model"], ["Pass 4: invariant 1, health-check before driving", "Never drive an instance you have not health-checked since it last did something surprising."], ["Pass 4: invariant 2, evidence survives every cleanup", "Evidence captured so far survives every cleanup"], ["Pass 4: invariant 3, nothing outlives its usefulness", "Nothing a drive started outlives its usefulness."], ["Pass 4: unreachable needs a concrete prerequisite and the route tried", "`verified-unreachable` only with the concrete prerequisite"], ["Pass 4: a harness fix is driven live again", "Every harness fix from triage is driven live again before it counts."], ["Pass 4: final teardown comes after the last drive and the evidence stays", "Final teardown comes after the last drive"], ["Pass 5: documentation drift is fixed", "documentation drift. Fix it."], ["Pass 5: a harness gap keeps the helper rule", "keep to the helper rule used at creation"], ["Pass 5: a product gap is recorded and kept out of the edits", "Record it for the user and keep it out of these edits."], ["Pass 6: commit, push and pull request are the user's decisions", "Committing, pushing, and opening a pull request are the user's decisions"], ["Pass 6: read every changed file again", "read every changed file again"], ["Notes: run notes stay outside tracked files and are not committed", "outside tracked files, and do not commit them"], ["Boundary: the first skill belongs to create-verification-skill", "| Create the first verification skill and its map | `create-verification-skill` skill |"], ["Boundary: formal verification upkeep belongs to maintain-formal-verification-skill", "| Re-align a formal verification model with changed code | `maintain-formal-verification-skill` skill |"], ["Boundary: completeness belongs to verify", "| Check that a code change is complete | `verify` skill |"], ["Boundary: splitting the source wave belongs to parallel-execution", "| Split the source wave across readers | `team` skill |"], ["Limits: one build on one machine", "The pass proves the map against one build on one machine."], ["Limits: product regressions are reported, never repaired here", "Product regressions are reported, never repaired here"], ["Pass: step 0 is locate the target", "0. **Locate the target.**"], ["Pass: step 1 is index hygiene", "1. **Index hygiene.**"], ["Pass: step 2 is source wave", "2. **Source wave.**"], ["Pass: step 3 is reconcile", "3. **Reconcile.**"], ["Pass: step 4 is live pass", "4. **Live pass.**"], ["Pass: step 5 is triage", "5. **Triage.**"], ["Pass: step 6 is apply or stop", "6. **Apply or stop.**"]];
for (const [name, needle] of RULES) check(`SKILL.md ${name}`, skill.includes(needle), skill.includes(needle) ? '' : `missing: ${needle.slice(0, 60)}`);

const description = /^description:\s*"([^"]*)"/m.exec(fm)?.[1] ?? '';
check('Language: description follows "<sentence>. Triggers: <Korean triggers>."', /^[A-Z][^\n]*\. Triggers: [^\n]*[가-힣][^\n]*\.$/.test(description), description);
check('Language: description fits 100 display columns (a Korean character counts as two)', description.length > 0 && width(description) <= 100, `${width(description)} columns`);
check('Language: description names its Korean and file triggers', ["검증 스킬", "점검"].every((term: string) => description.includes(term)));


const prose = flat([rawBody, ...[].map((file: string) => read(join(ROOT, 'references', file)))].join(' '));
const FORBID: [string, string, string][] = [["no Cursor or pstack references", "\\.cursor|poteto|pstack|Cursor|subagent", ""], ["no model slugs", "\\b(opus|sonnet|haiku|grok|gpt)-?\\d?", "i"]];
for (const [name, pattern, flags] of FORBID) check(`Language: ${name}`, !new RegExp(pattern, flags).test(prose));

check('NOTICE: states the skill is adapted from pstack (MIT)', /is adapted from pstack \(MIT\)/.test(noticeFlat));
check('NOTICE: pins the upstream commit', notice.includes(COMMIT));
check('NOTICE: says it is a rewrite and not a pinned copy', /not a pinned copy/.test(noticeFlat));
check('NOTICE: lists at least three changes', ((/## What changed\n([\s\S]*?)\n## /.exec(notice)?.[1] ?? '').match(/^- /gm) ?? []).length >= 3);
check('NOTICE: carries the MIT license text of the upstream author', notice.includes('Permission is hereby granted, free of charge') && notice.includes('Copyright (c) 2026 Lauren Tan'));
check('NOTICE: records what jstack added, including the tests', notice.includes('## Added by jstack') && notice.includes('`tests/`'));
const NOTICE_EXTRA: [string, string][] = [["NOTICE: names the Cursor path it replaced", ".cursor/skills/verify-*/"], ["NOTICE: names the upstream skill path", "skills/maintain-verification-skill/SKILL.md"]];
for (const [name, needle] of NOTICE_EXTRA) check(name, notice.includes(needle), notice.includes(needle) ? '' : `missing: ${needle}`);

check_skill_body(check, ROOT, { needles: ["approval before the first edit**", "is a gap, not a pass", "Never edit product code in this pass."], floor: 4050 });
check_contract_coverage(check, SUITE_FILE, ROOT, { per_file: {"SKILL.md": 54, "NOTICE": 8} });
check_body_deletion(check, SUITE_FILE, ROOT, { minimum: 54 });
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 74);
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} 통과`);
process.exitCode = passed === results.length ? 0 : 1;
