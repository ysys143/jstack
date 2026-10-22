#!/usr/bin/env node
/** Owning skill contracts. Individual assertions and measured deletion floors are preserved. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMain } from '../../../../../runtime/entry.js';
import { check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_total, split_frontmatter, check_skill_body, check_ref_contracts, check_body_paths, read_ref, type Result } from '../../../../_suite_lib.js';
const __file__ = fileURLToPath(import.meta.url);
const HERE = dirname(__file__), ROOT = dirname(HERE), SKILLS = dirname(ROOT);
const results: Result[] = [];
function check(name: string, ok: any, detail = ''): void {
    results.push([name, truth(ok), detail]);
    console.log(`[${truth(ok) ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function truth(value: any): boolean { return value instanceof Set ? value.size > 0 : Array.isArray(value) || typeof value === 'string' ? value.length > 0 : value !== null && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value); }
function iterable(value: any): any { return value != null && typeof value[Symbol.iterator] === 'function' ? value : Object.keys(value); }
function length(value: any): number { return value instanceof Set ? value.size : typeof value === 'string' ? Array.from(value).length : Array.isArray(value) ? value.length : Object.keys(value).length; }
function equal(a: any, b: any): boolean { return isDeepStrictEqual(a, b); }
function contains(haystack: any, needle: any): boolean { return typeof haystack === 'string' ? haystack.includes(needle) : [...iterable(haystack)].some((value: any) => equal(value, needle)); }
function starts(text: string, prefixes: string | string[]): boolean { return typeof prefixes === 'string' ? text.startsWith(prefixes) : prefixes.some(prefix => text.startsWith(prefix)); }
function sorted(value: any): any[] { return [...iterable(value)].sort((a: any, b: any) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0); }
function split(text: string, separator?: string | null, max?: number): string[] {
    if (separator == null) {
        const match = text.trim().match(/^(\S+)\s+([\s\S]*)$/);
        return max === 1 && match ? [match[1], match[2]] : text.trim().split(/\s+/);
    }
    if (max === undefined)
        return text.split(separator);
    const parts: string[] = [];
    let rest = text;
    while (parts.length < max) {
        const index = rest.indexOf(separator);
        if (index < 0)
            break;
        parts.push(rest.slice(0, index));
        rest = rest.slice(index + separator.length);
    }
    return [...parts, rest];
}
function regex(pattern: string, flags = ''): RegExp {
    const inline = pattern.match(/^\(\?([ims]+)\)/);
    if (inline) {
        flags += inline[1];
        pattern = pattern.slice(inline[0].length);
    }
    return new RegExp(pattern, [...new Set(flags)].join(''));
}
function regexSearch(pattern: string, text: string, flags = ''): RegExpExecArray | null { return regex(pattern, flags).exec(text); }
function regexFindall(pattern: string, text: string, flags = ''): any[] { return [...text.matchAll(regex(pattern, flags + 'g'))].map(match => match.length === 1 ? match[0] : match.length === 2 ? match[1] : match.slice(1)); }
function regexSub(pattern: string, replacement: string, text: string, flags = ''): string { return text.replace(regex(pattern, flags + 'g'), replacement); }
function isFile(path: string): boolean { try {
    return statSync(path).isFile();
}
catch {
    return false;
} }
function isDir(path: string): boolean { try {
    return statSync(path).isDirectory();
}
catch {
    return false;
} }
function* walk(root: string): Generator<[
    string,
    string[],
    string[]
]> {
    if (!isDir(root))
        return;
    const entries = readdirSync(root, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    yield [root, dirs, entries.filter(entry => !entry.isDirectory()).map(entry => entry.name)];
    for (const dir of dirs)
        yield* walk(join(root, dir));
}
function read(path: string): string { return readFileSync(path, "utf8"); }
function template(text: any): any {
    let m: any;
    m = regexSearch("```markdown\\n(.*?)```", text, "s");
    return (truth(m) ? m[1] : "");
}
function main(): any {
    let _: any, bound: any, doc_body: any, doc_heads: any, flat: any, fm: any, ftpl: any, h: any, heads: any, keep: any, label: any, missing: any, n: any, named: any, ok: any, omits: any, passed: any, r: any, row: any, sect: any, sel: any, sent: any, skill: any, tpl: any, v: any, why: any, word: any;
    [fm, skill] = split_frontmatter(read(join(ROOT, "SKILL.md")));
    tpl = template(skill);
    check("template: MADR template exists inside a markdown fence", (length(tpl) > 200), (String(length(tpl)) + "B"));
    heads = regexFindall("(?m)^## (.+)$", tpl);
    check("template: has at least five sections", (length(heads) >= 5), (String(heads)));
    for ([h, why] of iterable([["Status", "status"], ["Context", "context"], ["Decision", "decision"], ["Alternatives", "alternatives"], ["Consequences", "consequences"], ["Reversing it", "reversal"]])) {
        check(("template: " + String(why) + " section exists"), (contains(heads, h)));
    }
    check("template: file path convention exists", (contains(skill, "docs/adr/NNNN-title.md")));
    check("template: numbers are never reused", (contains(skill, "never reused")));
    check("template: all four status values are listed", (() => { const __items: any[] = []; for (const v of iterable(["Proposed", "Accepted", "Deprecated", "Superseded"])) {
        __items.push((contains(tpl, v)));
    } return __items; })().every(truth));
    check("alternatives: requires recording rejected options", (contains(tpl, "**rejected**")));
    check("alternatives: states why this section makes the document worth keeping", (truth((contains(tpl, "what makes the\ndocument worth keeping"))) || truth((contains(tpl, "what makes the document worth keeping")))));
    check("alternatives: provides a table and example row", (truth((contains(tpl, "| Alternative | Why rejected |"))) && truth((contains(tpl, "Approach B")))));
    check("alternatives: explains what an empty section records", (contains(skill, "this was the only thing considered")));
    check("consequences: requires recording costs", (contains(tpl, "**costs**")));
    check("consequences: forbids 'none' inside the template", (contains(tpl, "Do not write \"none\"")));
    check("consequences: a decision without cost is not a decision", (truth((contains(tpl, "a decision without a cost is\nnot a decision"))) || truth((contains(tpl, "a decision without a cost is not a decision")))));
    check("consequences: states that 'none' means no ADR is needed", (truth((contains(skill, "an\nADR is not needed"))) || truth((contains(skill, "ADR is not needed")))));
    check("supersession: forbids editing the old document", (contains(skill, "**Never edit the old document.**")));
    check("supersession: directs writing a new ADR and updating status", (contains(skill, "Superseded by NNNN")));
    check("supersession: the trail of changed judgment is the record", (contains(skill, "trail of changed judgment is itself the record")));
    check("selection: records only decisions expensive to reverse", (contains(skill, "**only decisions that are expensive to reverse**")));
    check("selection: states the consequence of recording everything", (contains(skill, "nobody reads any of it")));
    keep = regexFindall("(?m)^\\| (?!---)(?!Record\\b)(.+?) \\| (.+?) \\|$", skill);
    check("selection: record/do-not-record table has at least four rows", (length(keep) >= 4), (String(length(keep)) + " rows"));
    for ([word, why] of iterable([["Datastore", "datastore choice"], ["Variable names", "variable names"], ["Security and permission model", "security model"], ["Temporary workarounds", "temporary workaround"]])) {
        check(("selection: " + String(why) + " appears in the table"), (contains(skill, word)));
    }
    check("omissions: forbids mixing hindsight into context", (contains(tpl, "**Only what was known at decision time**")));
    check("omissions: explains what hindsight damages", (contains(tpl, "look foolish")));
    check("omissions: states that it misleads the next reader", (contains(skill, "misleads the next reader")));
    omits = regexFindall("(?m)^- \\*\\*(.+?)\\*\\*", skill);
    check("omissions: at least three commonly omitted items", (length(omits) >= 3), (String(length(omits)) + " items"));
    check("limits: supplies a format while the decision belongs to the user", (truth((contains(skill, "**a format**"))) && truth((contains(skill, "decision is the user's")))));
    check("limits: does not verify that the decision is correct", (contains(skill, "does not verify the decision is right")));
    named = new Set(iterable(regexFindall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
    missing = (() => { const __items: any[] = []; for (const n of iterable(named)) {
        if (!truth((!truth(isDir(join(SKILLS, n))))))
            continue;
        __items.push(n);
    } return __items; })();
    check("boundary: handoff target population is nonempty", (length(named) >= 2), (String(sorted(named))));
    check("boundary: all handoff targets exist", (!truth(missing)), ("missing " + String(missing)));
    check("Language: description names the Korean activation intent", ["기술 결정"].every(term => fm.includes(term)));
    check("language: description also contains English triggers", (truth((/adr/i.test(fm))) && truth((contains(fm, "architecture decision")))));
    flat = regexSub("\\s+", " ", skill, "");
    ftpl = regexSub("\\s+", " ", tpl, "");
    for ([label, sent] of iterable([["selection rule", "Record **only decisions that are expensive to reverse**. Record everything and nobody reads any of it."], ["forbid 'none'", "What this decision **costs**. Do not write \"none\" — a decision without a cost is not a decision."], ["why alternatives exist", "What was considered and **rejected**, and why. This section is what makes the document worth keeping."], ["meaning of empty alternatives", "- **An empty alternatives section** — that records \"this was the only thing considered\""], ["do not edit old documents", "**Never edit the old document.** Write a new ADR and set the old one's status to `Superseded by NNNN`."], ["the trail is the record", "The trail of changed judgment is itself the record."], ["decision correctness is not verified", "It does not verify the decision is right — only that the alternatives and consequences sections are filled"], ["numbers are never reused", "Numbers are sequential and never reused."], ["none means no ADR", "- **Consequences: \"none\"** — then it was not a choice but the only road, and an\nADR is not needed".replaceAll("\n", " ")], ["forbid hindsight", "**Only what was known at decision time** — mixing in what you learned later makes that judgment look foolish."], ["hindsight misleads readers", "- **Hindsight in the context** — writing what you did not know as if you did misleads the next reader about the basis for the call"], ["format-only limit", "This skill supplies **a format**. The decision is the user's"], ["reason to record", "**Six months on, somebody will ask \"why was it done this way?\"**"]])) {
        check(("sentence: " + String(label) + " exists verbatim"), (contains(flat, sent)), (truth((contains(flat, sent))) ? "" : ("missing: " + String(sent.slice(0, 48)) + "...")));
    }
    bound = regexFindall("(?m)^\\| (.+?) \\| `([a-z][a-z-]+)` skill \\|$", skill);
    check("boundary: plan owns deciding what to build", (contains(bound, ["Deciding what to build", "plan"])), (String(bound)));
    check("boundary: tdd owns implementation", (contains(bound, ["Implementation", "tdd"])), (String(bound)));
    check("boundary: boundary table has exactly two rows", (equal(length(bound), 2)), (String(length(bound)) + " rows"));
    for (row of iterable(["| Datastore, framework choice | Variable names |", "| Data formats, API contracts | Function extraction |", "| Taking on an external dependency | Code style |", "| Security and permission model | Temporary workarounds |"])) {
        check(("selection: row '" + String(split(row, " | ")[0].slice(2)) + "' preserves both columns"), (contains(skill, row)));
    }
    sect = regexSearch("(?ms)^## When to write one$(.*?)^## ", skill);
    sel = regexFindall("(?m)^\\| (?!-)(?!Record \\|)(.+?) \\| (.+?) \\|$", (truth(sect) ? sect[1] : ""));
    check("selection: record/do-not-record table has exactly four rows", (equal(length(sel), 4)), (String(length(sel)) + " rows " + String(sel)));
    check("template: status line lists four values in order", (contains(ftpl, "Proposed | Accepted | Deprecated | Superseded by NNNN")));
    check("template: rejection table header is verbatim", (contains(ftpl, "| Alternative | Why rejected |")));
    check("template: rejection example row is verbatim", (contains(ftpl, "| Approach B | At our scale the operational cost exceeds the gain |")));
    doc_body = regexSub("```markdown\\n.*?```", "", skill, "s");
    doc_heads = regexFindall("(?m)^## (.+)$", doc_body);
    check("skeleton: document section headings preserve order", (equal(doc_heads, ["Why record", "When to write one", "Format — MADR", "Changing status", "Commonly omitted", "Boundaries", "Limits (stated)"])), (String(doc_heads)));
    check("skeleton: template section headings preserve order", (equal(heads, ["Status", "Context", "Decision", "Alternatives", "Consequences", "Reversing it"])), (String(heads)));
    check("skeleton: exactly one markdown fence", (equal(length(regexFindall("(?m)^```markdown$", skill)), 1)), (String(length(regexFindall("(?m)^```markdown$", skill))) + " entries"));
    check_skill_body(check, ROOT, { needles: ["**only decisions that are expensive to reverse**", "**Never edit the old document.**", "Do not write \"none\"", "**Only what was known at decision time**", "docs/adr/NNNN-title.md"], floor: 1715 });
    check_contract_coverage(check, __file__, ROOT, { per_file: { "SKILL.md": 71 }, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_body_deletion(check, __file__, ROOT, { minimum: 71, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_no_constant_assertions(check, __file__);
    check_total(check, results, 81);
    passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) {
        if (!truth(ok))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    console.log(("\n" + String(passed) + "/" + String(length(results)) + " 통과"));
    return (truth((equal(passed, length(results)))) ? 0 : 1);
}
if (isMain(import.meta.url))
    process.exitCode = main();
