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
function subtract(a: any, b: any): any { return a instanceof Set ? new Set([...a].filter(value => !contains(b, value))) : a - b; }
function union(a: any, b: any): Set<any> { return new Set([...iterable(a), ...iterable(b)]); }
function count(value: any, part: any): number { return typeof value === 'string' ? value.split(part).length - 1 : value.filter((entry: any) => equal(entry, part)).length; }
function range(start: number, stop?: number): number[] { if (stop === undefined) {
    stop = start;
    start = 0;
} return Array.from({ length: stop - start }, (_, i) => i + start); }
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
const RULES = join(ROOT, "rules");
const NEXT_COUPLED = new Set(["server-hoist-static-io", "server-after-nonblocking", "server-cache-react", "server-auth-actions", "bundle-dynamic-imports", "bundle-analyzable-paths", "bundle-barrel-imports", "bundle-defer-third-party", "rendering-script-defer-async", "rendering-hydration-suppress-warning"]);
const OURS = { "SKILL.md": "locally authored decision layer", "NOTICE": "locally authored provenance record", "LICENSE.vercel-agent-skills": "record of the upstream MIT declaration", "UPSTREAM.sha256": "the manifest itself", "rules/_sections.md": "local merge of two upstream section lists into a twelve-section table" };
const IMPACTS = new Set(["CRITICAL", "HIGH", "MEDIUM-HIGH", "MEDIUM", "LOW-MEDIUM", "LOW"]);
function sha(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function manifest_rows(): any {
    let ln: any, out: any, parts: any;
    out = [];
    for (ln of iterable(read(join(ROOT, "UPSTREAM.sha256")).split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
        if (truth((truth(starts(ln, "#")) || truth((!truth(ln.trim())))))) {
            continue;
        }
        parts = split(ln, null, 1);
        if (truth((equal(length(parts), 2)))) {
            out.push([parts[0], parts[1].trim()]);
        }
    }
    return out;
}
function rule_files(): any {
    let f: any;
    return sorted((() => { const __items: any[] = []; for (const f of iterable(readdirSync(RULES))) {
        if (!truth((truth(f.endsWith(".md")) && truth((!truth(starts(f, "_")))))))
            continue;
        __items.push(f);
    } return __items; })());
}
function main(): any {
    let NEXT_RE: any, _: any, _skill_text: any, absent: any, actual: any, bad_impact: any, body: any, body_all: any, body_prefixes: any, d: any, declared: any, dn: any, dp: any, drift: any, extra: any, f: any, fm: any, fn: any, found: any, frag: any, h: any, k: any, listed: any, live_ran: any, m: any, missing: any, n: any, no_code: any, no_fm: any, no_pair: any, notice: any, ok: any, passed: any, r: any, rel: any, rows: any, sec: any, t: any, text: any, where: any, why: any;
    rows = manifest_rows();
    check("import: manifest contains every rule", (equal(length(rows), length(rule_files()))), ("manifest " + String(length(rows)) + " / rules " + String(length(rule_files()))));
    missing = (() => { const __items: any[] = []; for (const [_, r] of iterable(rows)) {
        if (!truth((!truth(isFile(join(ROOT, r))))))
            continue;
        __items.push(r);
    } return __items; })();
    check("import: every manifest file exists", (!truth(missing)), (String(missing.slice(0, 3))));
    drift = (() => { const __items: any[] = []; for (const [h, r] of iterable(rows)) {
        if (!truth((truth(isFile(join(ROOT, r))) && truth((!equal(sha(join(ROOT, r)), h))))))
            continue;
        __items.push(r);
    } return __items; })();
    check("import: manifest hashes match files", (!truth(drift)), ("drift " + String(length(drift)) + " entries " + String(drift.slice(0, 3))));
    listed = union(new Set((() => { const __items: any[] = []; for (const [_, r] of iterable(rows)) {
        __items.push(r);
    } return __items; })()), new Set(iterable(OURS)));
    extra = [];
    for ([dp, dn, fn] of iterable(walk(ROOT))) {
        dn.splice(0, dn.length, ...(() => { const __items: any[] = []; for (const d of iterable(dn)) {
            if (!truth((!contains(["__pycache__", "tests", "references"], d))))
                continue;
            __items.push(d);
        } return __items; })());
        for (f of iterable(sorted(fn))) {
            rel = relativeTo(join(dp, f), ROOT).replaceAll(sep, "/");
            if (truth((!contains(listed, rel)))) {
                extra.push(rel);
            }
        }
    }
    check("import: no files exist outside the manifest population", (!truth(extra)), ("unlisted " + String(extra.slice(0, 5))));
    for ([k, why] of iterable(sorted(Object.entries(OURS)))) {
        check(("import: exception " + String(k) + " exists and has a reason"), (truth(isFile(join(ROOT, k))) && truth(truth(why.trim()))));
    }
    sec = read(join(RULES, "_sections.md"));
    declared = new Set(iterable(regexFindall("\\|\\s*`([a-z0-9]+)-`\\s*\\|", sec)));
    actual = new Set((() => { const __items: any[] = []; for (const f of iterable(rule_files())) {
        __items.push(split(f, "-")[0]);
    } return __items; })());
    check("sections: table prefixes equal rule prefixes both ways", (equal(declared, actual)), ("table only " + String(sorted(subtract(declared, actual))) + " / files only " + String(sorted(subtract(actual, declared)))));
    check("sections: table contains twelve sections", (equal(length(declared), 12)), (String(length(declared)) + " sections"));
    _skill_text = read(join(ROOT, "SKILL.md"));
    body_prefixes = new Set(iterable(regexFindall("(?m)^\\|\\s*`([a-z0-9]+)-`\\s*\\|", _skill_text)));
    check("sections: SKILL.md routing prefixes equal files both ways", (equal(body_prefixes, actual)), ("table only " + String(sorted(subtract(body_prefixes, actual))) + " / files only " + String(sorted(subtract(actual, body_prefixes)))));
    check("sections: SKILL.md and _sections.md tables have the same set", (equal(body_prefixes, declared)), ("SKILL.md only " + String(sorted(subtract(body_prefixes, declared))) + " / _sections only " + String(sorted(subtract(declared, body_prefixes)))));
    NEXT_RE = regex("next\\.js|nextjs|next/", "i");
    found = new Set((() => { const __items: any[] = []; for (const f of iterable(rule_files())) {
        if (!truth(NEXT_RE.exec(read(join(RULES, f)))))
            continue;
        __items.push(f.slice(0, -3));
    } return __items; })());
    check("coupling: Next.js list equals files", (equal(found, NEXT_COUPLED)), ("files only " + String(sorted(subtract(found, NEXT_COUPLED))) + " / list only " + String(sorted(subtract(NEXT_COUPLED, found)))));
    body_all = read(join(ROOT, "SKILL.md"));
    notice = (read_ref(join(ROOT, "NOTICE")) || "");
    for ([where, text] of iterable([["SKILL.md", body_all], ["NOTICE", notice]])) {
        absent = sorted((() => { const __items: any[] = []; for (const n of iterable(NEXT_COUPLED)) {
            if (!truth((!contains(text, n))))
                continue;
            __items.push(n);
        } return __items; })());
        check(("coupling: " + String(where) + " names all ten Next.js rules"), (!truth(absent)), ("missing " + String(absent.slice(0, 3))));
    }
    [no_fm, bad_impact, no_pair, no_code] = [[], [], [], []];
    for (f of iterable(rule_files())) {
        t = read(join(RULES, f));
        [fm, _] = split_frontmatter(t);
        if (truth((truth((!truth(regexSearch("(?m)^title:", fm)))) || truth((!truth(regexSearch("(?m)^tags:", fm))))))) {
            no_fm.push(f);
        }
        m = regexSearch("(?m)^impact:\\s*(\\S+)", fm);
        if (truth((truth((!truth(m))) || truth((!contains(IMPACTS, m[1])))))) {
            bad_impact.push(f);
        }
        if (truth((!truth(regexSearch("(?m)^```", t))))) {
            no_code.push(f);
        }
        if (truth((!truth((truth(regexSearch("\\*\\*Incorrect", t)) && truth(regexSearch("\\*\\*Correct", t))))))) {
            no_pair.push(f.slice(0, -3));
        }
    }
    check("shape: every rule has title and tags frontmatter", (!truth(no_fm)), (String(no_fm.slice(0, 3))));
    check("shape: every impact is within declared grades", (!truth(bad_impact)), (String(bad_impact.slice(0, 3))));
    check("shape: pairless rules equal the six declared names", (equal(new Set(iterable(no_pair)), PAIRLESS)), ("files only " + String(sorted(subtract(new Set(iterable(no_pair)), PAIRLESS))) + " / declaration only " + String(sorted(subtract(PAIRLESS, new Set(iterable(no_pair)))))));
    check("shape: every rule has a code block", (!truth(no_code)), (String(no_code.slice(0, 3))));
    for (frag of iterable(["vercel-labs/agent-skills", "063bee9", "MIT"])) {
        check(("provenance: NOTICE names '" + String(frag) + "'"), (contains(notice, frag)));
    }
    check("provenance: NOTICE records four local changes", (equal((() => { const __items: any[] = []; for (const n of iterable(range(1, 5))) {
        __items.push(count(notice, ("**" + String(n) + ".")));
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0), 4)));
    check("provenance: SKILL.md includes the upstream link", (contains(body_all, "https://github.com/vercel-labs/agent-skills")));
    [fm, body] = split_frontmatter(body_all);
    check_body_paths(check, ROOT, body, { fm_of_skill: fm });
    check_skill_body(check, ROOT, { needles: ["The 78 rules are not ours.", "**`js-` needs no React.**", "out of scope elsewhere — not wrong", "Impact grades are claims, and claims get checked", "**Measure before and after when the rule claims a number.**", "as a hypothesis to confirm on the actual code path"], floor: SKILL_FLOOR });
    check_ref_contracts(check, ROOT, [["applying.md", "application and measurement contract survives", ["Measure numerical claims", "Do not reduce findings by deleting the subject", "When the project does not use Next.js, its ten rules are out of scope"], APPLYING_FLOOR]]);
    check_no_constant_assertions(check, __file__);
    live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) {
        if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    for (const [file, needles] of [["LICENSE.vercel-agent-skills", ["MIT License", "Permission is hereby granted", "vercel-labs/agent-skills"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
    check_contract_coverage(check, __file__, ROOT, { per_file: PER_FILE, completeness: false, live_ran: live_ran });
    check_body_deletion(check, __file__, ROOT, { minimum: BODY_MIN, live_ran: live_ran });
    check_total(check, results, TOTAL);
    passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) {
        if (!truth(ok))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    console.log(("\n" + String(passed) + "/" + String(length(results)) + " 통과"));
    return (truth((equal(passed, length(results)))) ? 0 : 1);
}
const SKILL_FLOOR = 2786;
const APPLYING_FLOOR = 1981;
const BODY_MIN = 18;
const TOTAL = 53;
const PAIRLESS = new Set(["bundle-conditional", "bundle-preload", "rendering-activity", "rendering-content-visibility", "rendering-resource-hints", "server-cache-lru"]);
const PER_FILE = {"LICENSE.vercel-agent-skills": 2,  "SKILL.md": 18, "NOTICE": 6, "UPSTREAM.sha256": 2, "rules/_sections.md": 4, "references/applying.md": 4 };
if (isMain(import.meta.url))
    process.exitCode = main();
