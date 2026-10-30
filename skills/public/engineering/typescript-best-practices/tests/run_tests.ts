/** Owning contracts for typescript-best-practices: production TypeScript rules for types and for the places data enters the program. */
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

const RULES: [string, string][] = [["Intro: the compiler rejects impossible states, mismatched primitives and unhandled variants", "Make the compiler reject impossible states, mismatched primitives, and unhandled variants"], ["Intro: check data once where it crosses in and trust the types after", "Check data once, where it crosses into the program, and trust the types after that."], ["Intro: test design belongs to test-driven-development", "Test design belongs to `test-driven-development`."], ["Rules: a brand comes from a verifying parse, never from as", "A brand comes from a verifying parse or guard, never from `as`"], ["Rules: strengthen a loose type only where it forces a cast", "Strengthen it only where the loose type forces a `!`, a cast, or a \"should never happen\" throw"], ["Rules: outside data is unknown until parsed, including JSON.parse and process.env", "`JSON.parse`, `fetch` bodies, `process.env`, file contents, and IPC messages all count"], ["Rules: never keep a schema, an interface and a guard that can drift apart", "never keep a schema, a duplicate interface, and a guard that can drift apart"], ["Rules: cast only after validation and prefer satisfies", "Cast only after validation, and prefer `satisfies` when the goal is only to check a value"], ["Rules: a lying guard is worse than as", "A guard that lies is worse than `as`"], ["Rules: exhaustiveness uses a never local", "const _exhaustive: never = x;"], ["Rules: derive types instead of declaring a parallel interface", "instead of declaring a parallel interface"], ["Rules: object arguments skip hot paths", "Skip it on hot paths such as parsers and tokenizers"], ["Rules: the examples live in references/patterns.md", "Code examples for each rule are in `references/patterns.md`."], ["Boundary: validation sits at the system's edges", "Validation, narrowing, and error handling belong at the system's edges"], ["Boundary: parse into a named domain type", "Parse where data crosses in, into a named domain type."], ["Boundary: Record<string, unknown> lives only until the parse", "may exist only until that parse"], ["Boundary: no re-validation deep in a call chain", "Do not re-validate deep in a call chain."], ["Boundary: do not re-export wire types", "Do not re-export transport, storage, framework, or wire types through a public surface"], ["Boundary: pure functions with a thin shell", "Keep logic in pure functions and the shell thin."], ["Boundary: persisted JSON is versioned", "Persisted JSON is a boundary too: version the blob"], ["Boundary: wire formats ignore unknown fields", "Wire formats should ignore unknown fields"], ["Boundary: is this data crossing a boundary right now", "*Is this data crossing a boundary right now?*"], ["Boundary: could this be a pure function the shell calls", "*Could this be a pure function that the shell calls?*"], ["Neighbors: tests belong to test-driven-development", "| Writing the tests for a feature | `tdd` skill |"], ["Neighbors: restructuring belongs to refactor", "| Restructuring existing code under test | `cleanup` skill |"], ["Neighbors: completeness belongs to verify", "| Whether finished work is complete | `verify` skill |"], ["Neighbors: React performance belongs to react-performance", "| React and Next.js performance rules | `react` skill |"], ["Limits: a rule yields to the repository", "A rule yields to the repository."], ["Limits: do not add a dependency for one guard", "Do not add a dependency for one guard"], ["Rules: table row Discriminated unions", "| Discriminated unions |"], ["Rules: table row Branded types", "| Branded types |"], ["Rules: table row Constructive modeling", "| Constructive modeling |"], ["Rules: table row Simplest total type", "| Simplest total type |"], ["Rules: table row `unknown` over `any`", "| `unknown` over `any` |"], ["Rules: table row Parse, then trust", "| Parse, then trust |"], ["Rules: table row No `as` casts", "| No `as` casts |"], ["Rules: table row Narrowing order", "| Narrowing order |"], ["Rules: table row Honest guards", "| Honest guards |"], ["Rules: table row Exhaustiveness", "| Exhaustiveness |"], ["Rules: table row Derive, do not duplicate", "| Derive, do not duplicate |"], ["Rules: table row Object arguments", "| Object arguments |"], ["Rules: table row Real tests over mocks", "| Real tests over mocks |"]];
for (const [name, needle] of RULES) check(`SKILL.md ${name}`, skill.includes(needle), skill.includes(needle) ? '' : `missing: ${needle.slice(0, 60)}`);

const description = /^description:\s*"([^"]*)"/m.exec(fm)?.[1] ?? '';
check('Language: description follows "<sentence>. Triggers: <Korean triggers>."', /^[A-Z][^\n]*\. Triggers: [^\n]*[가-힣][^\n]*\.$/.test(description), description);
check('Language: description fits 100 display columns (a Korean character counts as two)', description.length > 0 && width(description) <= 100, `${width(description)} columns`);
check('Language: description names its Korean and file triggers', [".ts", ".tsx", "타입스크립트", "타입 설계"].every((term: string) => description.includes(term)));


const prose = flat([rawBody, ...["patterns.md"].map((file: string) => read(join(ROOT, 'references', file)))].join(' '));
const FORBID: [string, string, string][] = [["no pstack or Cursor references", "\\.cursor|poteto|pstack|principle skill", ""], ["no model slugs", "\\b(opus|sonnet|haiku|grok|gpt)-?\\d?", "i"]];
for (const [name, pattern, flags] of FORBID) check(`Language: ${name}`, !new RegExp(pattern, flags).test(prose));
const FM_FORBID: [string, string][] = [["frontmatter has no paths key (no jstack skill uses one)", "^paths:"]];
for (const [name, pattern] of FM_FORBID) check(`Language: ${name}`, !new RegExp(pattern, 'm').test(fm));

check('NOTICE: states the skill is adapted from pstack (MIT)', /is adapted from pstack \(MIT\)/.test(noticeFlat));
check('NOTICE: pins the upstream commit', notice.includes(COMMIT));
check('NOTICE: says it is a rewrite and not a pinned copy', /not a pinned copy/.test(noticeFlat));
check('NOTICE: lists at least three changes', ((/## What changed\n([\s\S]*?)\n## /.exec(notice)?.[1] ?? '').match(/^- /gm) ?? []).length >= 3);
check('NOTICE: carries the MIT license text of the upstream author', notice.includes('Permission is hereby granted, free of charge') && notice.includes('Copyright (c) 2026 Lauren Tan'));
check('NOTICE: records what jstack added, including the tests', notice.includes('## Added by jstack') && notice.includes('`tests/`'));
const NOTICE_EXTRA: [string, string][] = [["NOTICE: names the boundary principle it absorbed", "skills/principle-boundary-discipline/SKILL.md"], ["NOTICE: names the type-system principle it absorbed", "skills/principle-type-system-discipline/SKILL.md"], ["NOTICE: names the upstream patterns file", "skills/typescript-best-practices/references/patterns.md"]];
for (const [name, needle] of NOTICE_EXTRA) check(name, notice.includes(needle), notice.includes(needle) ? '' : `missing: ${needle}`);

const REF_FORBID: [string, string][] = [["patterns.md: the parse example uses no cast to Record", "raw as Record"]];
const refText = read(join(ROOT, 'references', "patterns.md"));
for (const [name, pattern] of REF_FORBID) check(name, refText.length > 0 && !new RegExp(pattern).test(refText));

check_ref_contracts(check, ROOT, [["patterns.md", "TypeScript patterns: one example per rule, cast-free parse, never-local exhaustiveness", ["## Discriminated unions", "## Branded types", "## Constructive modeling", "## Simplest total type", "## `unknown` over `any`", "## Parse, then trust", "## No `as` casts", "## `satisfies` instead of `as`", "## Narrowing order", "## Honest guards", "## Exhaustiveness", "## Derive, do not duplicate", "## Object arguments", "## Boundary in practice", "readonly __brand: \"TaskId\"", "const _exhaustive: never = job;", "items is NonEmpty<T>"], 4950]] as [string, string, string[], number][]);
check_skill_body(check, ROOT, { needles: ["Make the compiler reject impossible states", "## Boundary discipline", "Do not add a dependency for one guard"], floor: 3200 });
check_contract_coverage(check, SUITE_FILE, ROOT, { per_file: {"SKILL.md": 50, "NOTICE": 9, "references/patterns.md": 4} });
check_body_deletion(check, SUITE_FILE, ROOT, { minimum: 50 });
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 77);
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} 통과`);
process.exitCode = passed === results.length ? 0 : 1;
