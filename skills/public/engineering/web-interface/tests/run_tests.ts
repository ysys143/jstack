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
function count(value: any, part: any): number { return typeof value === 'string' ? value.split(part).length - 1 : value.filter((entry: any) => equal(entry, part)).length; }
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
const GUIDE = join(ROOT, "references", "web-interface-guidelines.md");
const SECTIONS = ["Accessibility", "Focus States", "Forms", "Animation", "Typography", "Content Handling", "Images", "Performance", "Navigation & State", "Touch & Interaction", "Safe Areas & Layout", "Dark Mode & Theming", "Locale & i18n", "Hydration Safety", "Hover & Interactive States", "Content & Copy", "Anti-patterns (flag these)"];
function main(): any {
    let _: any, body: any, body_all: any, claimed: any, fetchy: any, fm: any, frag: any, g: any, h: any, live_ran: any, ln: any, missing: any, n: any, notice: any, ok: any, ok_hash: any, p: any, passed: any, r: any, rel: any, rows: any, s: any;
    rows = (() => { const __items: any[] = []; for (const ln of iterable(read(join(ROOT, "UPSTREAM.sha256")).split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
        if (!truth((truth(ln.trim()) && truth((!truth(starts(ln, "#")))))))
            continue;
        __items.push(split(ln, null, 1));
    } return __items; })();
    check("import: manifest has one row", (equal(length(rows), 1)), (String(length(rows)) + " rows"));
    ok_hash = false;
    if (truth(rows)) {
        [h, rel] = [rows[0][0], rows[0][1].trim()];
        p = join(ROOT, rel);
        ok_hash = (truth(isFile(p)) && truth((equal(createHash("sha256").update(readFileSync(p)).digest("hex"), h))));
    }
    check("import: rule source matches the manifest hash", ok_hash);
    g = (read_ref(GUIDE) || "");
    missing = (() => { const __items: any[] = []; for (const s of iterable(SECTIONS)) {
        if (!truth((!contains(g, ("### " + String(s))))))
            continue;
        __items.push(s);
    } return __items; })();
    check("rules: all 17 sections are present", (!truth(missing)), ("missing " + String(missing.slice(0, 3))));
    n = length(regexFindall("(?m)^- ", g));
    check(("rules: contains " + String(RULE_COUNT) + " entries"), (equal(n, RULE_COUNT)), (String(n) + " entries"));
    check("rules: anti-pattern section survives", (contains(g, "### Anti-patterns (flag these)")));
    check("rules: output-format section survives", (contains(g, "## Output Format")));
    body_all = read(join(ROOT, "SKILL.md"));
    fetchy = regexFindall("(?mi)^[^|>]*(?:WebFetch|fetch the (?:latest|fresh))[^\\n]*", body_all);
    check("import: SKILL.md does not tell the agent to fetch rules", (!truth(fetchy)), (String(fetchy.slice(0, 2))));
    check("import: rule source is a local file", isFile(GUIDE));
    notice = (read_ref(join(ROOT, "NOTICE")) || "");
    for (frag of iterable(["vercel-labs/web-interface-guidelines", "e3d624b", "MIT"])) {
        check(("provenance: NOTICE names '" + String(frag) + "'"), (contains(notice, frag)));
    }
    check("provenance: NOTICE gives three reasons for vendoring instead of fetching", (truth(count(notice, "\n1. ")) && truth(count(notice, "\n2. ")) && truth(count(notice, "\n3. "))));
    check("provenance: SKILL.md includes the upstream link", (contains(body_all, "https://github.com/vercel-labs/web-interface-guidelines")));
    claimed = regexFindall("(?m)^(\\d+) rules across", body_all);
    check("import: the rule count claimed by SKILL.md matches the files", (truth(claimed) && truth((equal(Number(claimed[0]), RULE_COUNT)))), ("document " + String(claimed) + " / files " + String(RULE_COUNT)));
    check("import: SKILL.md says to read the local file rather than fetch", (contains(body_all, "Ours reads a file.")), "evidence that vendoring reverted to fetching");
    [fm, body] = split_frontmatter(body_all);
    check_body_paths(check, ROOT, body, { fm_of_skill: fm });
    check_skill_body(check, ROOT, { needles: ["The rules are not ours.", "**What we changed is one thing: we vendored them.**", "**Do not\nparaphrase it from memory**", "a review that says \"no findings\" means a person or a model\n  read the files", "**No machine checks this.**", "these are findings, not preferences", "React Native is out of scope."], floor: SKILL_FLOOR });
    check_ref_contracts(check, ROOT, [["web-interface-guidelines.md", "upstream rule source (vendored unaltered)", ["Icon-only buttons need `aria-label`", "### Anti-patterns (flag these)", "## Output Format"], GUIDE_FLOOR]]);
    const designPackDir = join(ROOT, "assets", "design-packs");
    const designPackNames = readdirSync(designPackDir).filter(name => name.endsWith(".md")).sort();
    for (const name of designPackNames) {
        const content = readFileSync(join(designPackDir, name), "utf8");
        check(`design pack: ${name} is substantive`, content.startsWith("#") && content.length >= 500, `${content.length}B`);
    }
    check_no_constant_assertions(check, __file__);
    live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) {
        if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    for (const [file, needles] of [["LICENSE.web-interface-guidelines", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
    check_contract_coverage(check, __file__, ROOT, { per_file: PER_FILE, live_ran: live_ran });
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
const SKILL_FLOOR = 2073;
const GUIDE_FLOOR = 6147;
const BODY_MIN = 16;
const TOTAL = 125;
const RULE_COUNT = 103;
const PER_FILE = {"LICENSE.web-interface-guidelines": 1,  "SKILL.md": 16, "NOTICE": 4, "UPSTREAM.sha256": 2, "references/web-interface-guidelines.md": 8, ...Object.fromEntries(readdirSync(join(ROOT, "assets", "design-packs")).filter(name => name.endsWith(".md")).map(name => [`assets/design-packs/${name}`, 1])) };
if (isMain(import.meta.url))
    process.exitCode = main();
