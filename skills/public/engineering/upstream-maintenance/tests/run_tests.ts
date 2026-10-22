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
function regexFindall(pattern: string, text: string, flags = ''): any[] { return [...text.matchAll(regex(pattern, flags + 'g'))].map(match => match.length === 1 ? match[0] : match.length === 2 ? match[1] : match.slice(1)); }
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
function relativeTo(path: string, root: string): string { return relative(root, path); }
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
function rows(text: any, head: any): any {
    let body: any, out: any, r: any;
    if (truth((!contains(text, head)))) {
        return [];
    }
    body = split(split(text, head, 1)[1], "\n## ", 1)[0];
    out = regexFindall("(?m)^\\| (?!---)(.+?) \\|", body);
    return (() => { const __items: any[] = []; for (const r of iterable(out)) {
        if (!truth((!contains(["Field", "Class"], r.trim()))))
            continue;
        __items.push(r);
    } return __items; })();
}
function main(): any {
    let _: any, _dn: any, both: any, contra: any, dp: any, fields: any, fm: any, fns: any, lic: any, lic_path: any, missing: any, n: any, named: any, ok: any, owned: any, passed: any, r: any, ref_dir: any, skill: any, steps: any, t: any, uncited: any;
    [fm, skill] = split_frontmatter(read(join(ROOT, "SKILL.md")));
    lic_path = join(ROOT, "references", "license-classes.md");
    lic = read_ref(lic_path);
    check("reference: references/license-classes.md exists", (lic !== null), (truth((lic !== null)) ? "" : "file missing; its entire contract disappears"));
    lic = (lic || "");
    ref_dir = join(ROOT, "references");
    owned = sorted((() => { const __items: any[] = []; for (const [dp, _dn, fns] of iterable(walk(ref_dir))) {
        for (const n of iterable(fns)) {
            if (!truth((truth((!truth(starts(n, ".")))) && truth((!truth(n.endsWith(".lines")))))))
                continue;
            __items.push(relativeTo(join(dp, n), ROOT).replaceAll(sep, "/"));
        }
    } return __items; })());
    uncited = (() => { const __items: any[] = []; for (const r of iterable(owned)) {
        if (!truth((!contains(skill, ("`" + String(r) + "`")))))
            continue;
        __items.push(r);
    } return __items; })();
    check("citations: body uses prefixed relative paths for reference files", (truth(truth(owned)) && truth((!truth(uncited)))), (truth(uncited) ? ("uncited " + String(uncited)) : (String(length(owned)) + " entries")));
    check("license: copy is the default", (contains(skill, "**The default is to bring it in.**")));
    check("license: requires recording the none class", (contains(skill, "including `none`")));
    check("license: recording is not asking permission", (truth((contains(skill, "not\npermission-seeking"))) || truth((contains(skill, "not permission-seeking")))));
    check("license: lists the narrow pre-review set", (truth((contains(skill.toLowerCase(), "strong copyleft"))) && truth((contains(skill.toLowerCase(), "non-commercial"))) && truth((contains(skill.toLowerCase(), "vendor-internal")))));
    check("license: grounds the three classes in user obligations", (truth((contains(skill, "obligations on *other people*"))) && truth((contains(skill, "not about our risk")))));
    check("license: reimplementation always remains available", (truth((contains(skill, "Reimplementation is always open"))) && truth((contains(skill, "expression, not the idea")))));
    check("license: states when to reimplement; missing license is not itself a reason", (contains(skill, "Not because a file was missing")));
    check("license: classification table has at least six rows", (length(rows(lic, "## The classes")) >= 6), (String(length(rows(lic, "## The classes"))) + " rows"));
    check("table: classification table has header and separator", (truth((contains(lic, "| Class | May be vendored | Obligation carried into this repository |"))) && truth((contains(lic, "\n| --- | --- | --- |\n")))));
    check("license: no-license row exists", (contains(lic, "No licence file")));
    check("license: no-license row now allows by default", (contains(lic, "| No licence file | **Yes, by default** |")));
    check("license: explains what recording buys", (contains(lic, "What the record buys")));
    check("license: proprietary row lists prohibitions", (contains(lic, "derivative works are all forbidden")));
    check("license: requires recording full text rather than a name", (truth((contains(lic, "Record the **full text**"))) && truth((contains(lic, "only \"MIT\" is not")))));
    check("license: calls this measurement rather than awareness", (truth((contains(lic, "is a recollection"))) && truth((contains(lic, "read it")))));
    check("license: gives a subdirectory with separate terms", (contains(lic, "can contain a non-commercial dataset")));
    check("license: NC use restrictions follow downstream", (contains(lic, "follows every downstream")));
    check("license: states the consequence of silently importing NC", (contains(lic, "converts every commercial user into a violator")));
    check("license: distinguishes unknown from no license", (contains(lic, "are different states")));
    check("license: imports and records unknown classifications", (contains(lic, "Import it and record the state")));
    check("license: identifies classes that still stop", (truth((contains(lic, "obligations land on\nour users"))) || truth((contains(lic, "obligations land on our users")))));
    both = ((skill + "\n") + lic).toLowerCase();
    contra = (() => { const __items: any[] = []; for (const t of iterable(["never copy", "do not copy", "must not copy", "never vendor anything", "written permission", "obtain permission", "permission before copying", "the default is not to bring it in", "unlicensed is not permissive"])) {
        if (!truth((contains(both, t))))
            continue;
        __items.push(t);
    } return __items; })();
    check("policy: no phrase contradicts copy-by-default", (!truth(contra)), (truth(contra) ? ("contradictory phrases " + String(contra)) : "0 entries"));
    check("L0: description advertises importing with license and provenance", (/Import/.test(fm) && /license/.test(fm) && /provenance/.test(fm)));
    check("records: requires recording paths", (contains(skill, "Record the path, not the line")));
    check("records: line numbers alone are unverifiable", (truth((contains(skill, "cannot be checked"))) && truth((contains(skill, "a week later")))));
    check("records: line numbers move while paths remain", (truth((contains(skill, "Line numbers move"))) && truth((contains(skill, "paths do not")))));
    fields = rows(skill, "## Record the path, not the line");
    check("records: required-fields table has at least four rows", (length(fields) >= 4), (String(length(fields)) + " rows"));
    check("table: record-fields table has header and separator", (truth((contains(skill, "| Field | Why it is not optional |"))) && truth((contains(skill, "\n| --- | --- |\n")))));
    check("records: defines 'measured' license", (contains(skill, "you opened the licence file")));
    check("records: record lives beside files rather than in a plan", (truth((contains(skill, "not in a plan document"))) && truth((contains(skill, "Plans get archived")))));
    check("import: requires byte-identical copies", (contains(skill, "byte-identical")));
    check("import: requires edits in a separate commit", (contains(skill, "**separate**")));
    check("import: explains what a combined commit destroys", (truth((contains(skill, "cannot be diffed against\nupstream"))) || truth((contains(skill, "cannot be diffed against upstream")))));
    check("import: builds manifest from originals, not copies", (contains(skill, "generated from the copy proves nothing")));
    check("import: requires suite validation of the manifest", (contains(skill, "check it in the suite")));
    check("validator: requires importing tests with tools", (contains(skill, "Bring the test with the tool")));
    check("validator: untested validators rot silently", (truth((contains(skill, "rots\nsilently"))) || truth((contains(skill, "rots silently")))));
    check("validator: cannot distinguish not found from not checked", (contains(skill, "between \"found nothing\" and")));
    check("validator: calls it an unearned green signal", (contains(skill, "green signal you did not earn")));
    check("CLI: does not vendor maintained CLIs", (contains(skill, "Do not vendor a maintained CLI")));
    check("CLI: states what reimplementation inherits", (contains(skill, "inherits the bugs the upstream already fixed")));
    check("CLI: defines what may be vendored", (contains(skill, "when the asset is *content*")));
    check("CLI: when absent, guide and stop rather than install", (truth((contains(skill, "say what to install and stop"))) && truth((contains(skill, "belongs to them")))));
    steps = regexFindall("(?m)^\\d\\. ", skill);
    check("updates: procedure has four steps", (length(steps) >= 4), (String(length(steps)) + " steps"));
    check("updates: diff equals upstream changes", (contains(skill, "that diff is the upstream change")));
    check("updates: updates version and manifest in one commit", (contains(skill, "in that commit")));
    check("updates: step 2 is bound to diffing the recorded manifest", (contains(skill, "2. Diff it against the recorded manifest — that diff is the upstream change.")));
    check("updates: step 4 binds version and manifest updates", (contains(skill, "4. Update the version field and the manifest together, in that commit.")));
    check("updates: steps 1 and 3 bind refetching and reapplying local changes", (truth((contains(skill, "1. Re-fetch the same asset at the new version."))) && truth((contains(skill, "3. Re-apply the recorded local changes on top, as their own commit.")))));
    check("updates: requires reimport when no reapplication record exists", (contains(skill, "re-import from upstream rather than to guess")));
    named = new Set(iterable(regexFindall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
    missing = (() => { const __items: any[] = []; for (const n of iterable(named)) {
        if (!truth((!truth(isDir(join(SKILLS, n))))))
            continue;
        __items.push(n);
    } return __items; })();
    check("boundary: handoff target population is nonempty", (length(named) >= 2), (String(sorted(named))));
    check("boundary: all handoff targets exist", (!truth(missing)), ("missing " + String(missing)));
    check("boundary: states skill scope in one sentence", (truth((contains(skill, "the decision,\nthe record, and the bytes"))) || truth((contains(skill, "the decision, the record, and the bytes")))));
    check("Language: description names the Korean activation intent", ["업스트림 반영", "외부 코드"].every(term => fm.includes(term)));
    check("language: description also contains English triggers", (truth((contains(fm, "third-party"))) && truth((contains(fm, "provenance")))));
    check_skill_body(check, ROOT, { needles: ["**The default is to bring it in.**", "Reimplementation is always open", "Record the path, not the line", "Bring the test with the tool", "Do not vendor a maintained CLI", "byte-identical"], floor: 2572 });
    check_ref_contracts(check, ROOT, [["license-classes.md", "classification table, full-text record, measurement, NC, and unknown", ["No licence file", "Record the **full text**", "is a recollection", "follows every downstream", "are different states", "What the record buys"], 1645]]);
    check_contract_coverage(check, __file__, ROOT, { per_file: { "SKILL.md": 45, "references/license-classes.md": 17 }, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_body_deletion(check, __file__, ROOT, { minimum: 45, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_no_constant_assertions(check, __file__);
    check_total(check, results, 76);
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
