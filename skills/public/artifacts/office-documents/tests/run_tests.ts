#!/usr/bin/env node
/** Owning skill contracts. Individual assertions and measured deletion floors are preserved. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMain } from '../../../../../runtime/entry.js';
import { check_script_contracts, check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_total, split_frontmatter, check_skill_body, check_ref_contracts, check_body_paths, read_ref, type Result } from '../../../../_suite_lib.js';
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
function subtract(a: any, b: any): any { return a instanceof Set ? new Set([...a].filter(value => !contains(b, value))) : a - b; }
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
function regexMatch(pattern: string, text: string): RegExpExecArray | null { const match = regexSearch(pattern, text); return match?.index === 0 ? match : null; }
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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { zipSync, strToU8 } from 'fflate';
let test_router: any = null, _ROUTER_IMPORT_ERROR = '';
try {
    test_router = await import('./test_router.js');
}
catch (e) {
    _ROUTER_IMPORT_ERROR = String(e);
}
function callable(value: unknown): boolean { return typeof value === 'function'; }
function read(path: string): string { return readFileSync(path, 'utf8'); }
const SCRIPTS = join(ROOT, "scripts");
const CHECK = join(SCRIPTS, "check_cjk_font.js");
const ENSURE = join(SCRIPTS, "ensure_officecli.js");
const ROUTER_CHECKS = 9;
const SECTION_SKELETON = [["## Backend: OfficeCLI", ["npx --yes @officecli/officecli@latest", "global\nchange"]], ["## Phase 0: availability", ["ensure_officecli.js", "exit 0", "exit 1", "exit 2"]], ["## Phase 1: choose the format", ["| Signal | Format |", "tests/test_router.js"]], ["## Phase 2: query the tool's schema", ["help docx", "Quote paths"]], ["## Phase 3: Korean font contract (required)", ["<a:ea>", "check_cjk_font.js", "Pretendard"]], ["## Phase 4: procurement conventions", ["req_coverage.js", "procurement"]], ["## Phase 5: save and inspect", ["officecli close", "close"]], ["## Explicit limitations", [".doc", "refresh"]]];
function split_sections(body: any): any {
    let buf: any, line: any, out: any, title: any;
    [out, title, buf] = [{}, null, []];
    for (line of iterable(body.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
        if (truth(starts(line, "## "))) {
            if (truth((title !== null))) {
                out[title] = Array.from(buf).join("\n");
            }
            [title, buf] = [line.trimEnd(), []];
        }
        else {
            if (truth((title !== null))) {
                buf.push(line);
            }
        }
    }
    if (truth((title !== null))) {
        out[title] = Array.from(buf).join("\n");
    }
    return out;
}
function make_pptx(path: string, opts: {
    ea?: string | null;
    text?: string;
} = {}): void {
    const ea_tag = opts.ea ? `<a:ea typeface="${opts.ea}"/>` : '';
    const slide = '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + `<p:cSld><a:rPr>${ea_tag}</a:rPr><a:t>${opts.text ?? '한글 본문'}</a:t></p:cSld></p:sld>`;
    writeFileSync(path, zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'), 'ppt/slides/slide1.xml': strToU8(slide) }));
}
function main(): any {
    let _: any, _before: any, _bodytxt: any, _d0: any, _d1: any, _gone: any, _miss: any, _order: any, _router: any, _sections: any, _skill_raw: any, _t: any, _thin: any, _titles: any, _toks: any, _want: any, _why: any, code_only: any, d: any, dests: any, ensure_src: any, exec_lines: any, i: any, k: any, l: any, live_ran: any, m: any, offending: any, ok: any, out: any, p_lat: any, p_no: any, p_ok: any, part: any, passed: any, r: any, rc: any, rows: any, skill: any, skill_fm: any, src: any, t: any, tmp: any;
    tmp = mkdtempSync(join(tmpdir(), "jstack-office-"));
    _skill_raw = read(join(ROOT, "SKILL.md"));
    [skill_fm, skill] = split_frontmatter(_skill_raw);
    ensure_src = read(ENSURE);
    check("Policy: SKILL.md forbids officecli install", (truth((contains(skill, "Do not run `officecli install`"))) || truth((contains(skill, "Do not run officecli install")))));
    check("Policy: explains global installation into every agent", (truth((contains(skill, "every detected AI agent"))) || truth((contains(skill, "global")))));
    exec_lines = (() => { const __items: any[] = []; for (const l of iterable(ensure_src.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
        if (!truth((truth(l.trim()) && truth((!truth(starts(l.trim(), "#")))))))
            continue;
        __items.push(l);
    } return __items; })();
    offending = (() => { const __items: any[] = []; for (const l of iterable(exec_lines)) {
        if (!truth((truth(regexSearch("(?<![\\w-])install(?![\\w-])", l)) && truth((!truth(regexMatch("\\s*(printf|echo|say|console\\.log)\\b", l)))))))
            continue;
        __items.push(l.trim());
    } return __items; })();
    check("Policy: ensure does not call install", (!truth(offending)), String(offending.slice(0, 1)));
    p_ok = join(tmp, "ok.pptx");
    p_no = join(tmp, "no.pptx");
    p_lat = join(tmp, "latin.pptx");
    make_pptx(p_ok, { ea: "Pretendard" });
    make_pptx(p_no, { ea: null });
    make_pptx(p_lat, { ea: null, text: "Latin only body" });
    function run_check(path: string, ...extra: string[]): [
        number | null,
        string
    ] { const r = spawnSync(process.execPath, [CHECK, path, ...extra], { encoding: 'utf8' }); return [r.status, r.stdout ?? '']; }
    [rc, _] = run_check(p_ok);
    check("CJK: Korean file with ea passes", (equal(rc, 0)), ("exit=" + String(rc)));
    [rc, out] = run_check(p_no);
    check("CJK: Korean file without ea fails", (truth((equal(rc, 1))) && truth((contains(out, "assignments (<a:ea> / w:eastAsia): 0")))), ("exit=" + String(rc)));
    [rc, out] = run_check(p_lat);
    check("CJK: file without Korean is outside scope", (truth((equal(rc, 0))) && truth((contains(out, "does not apply")))), ("exit=" + String(rc)));
    [rc, _] = run_check(p_ok, "--require-font", "NanumGothic");
    check("CJK: required-font mismatch fails", (equal(rc, 1)), ("exit=" + String(rc)));
    [rc, out] = run_check(p_ok, "--require-font", "Pretendard");
    check("CJK: required-font match passes", (truth((equal(rc, 0))) && truth((contains(out, "[OK]")))), ("exit=" + String(rc) + " / [OK] " + String((truth((contains(out, "[OK]"))) ? "present" : "absent"))));
    [rc, out] = run_check(p_ok, "--require-font", "pretend");
    check("CJK: font matching is case-insensitive and accepts substrings", (truth((equal(rc, 0))) && truth((contains(out, "[OK]")))), ("exit=" + String(rc)));
    [rc, _] = run_check(join(tmp, "nope.pptx"));
    check("CJK: missing file exits 2", (equal(rc, 2)), ("exit=" + String(rc)));
    src = read(CHECK);
    check("CJK: checker inspects XML a:ea", (truth((contains(src, "a:ea"))) && truth((contains(src, "typeface")))));
    code_only = Array.from((() => { const __items: any[] = []; for (const [i, part] of iterable(split(src, "\"\"\"").map((v: any, i: number) => [i, v]))) {
        if (!truth((equal((i % 2), 0))))
            continue;
        __items.push(part);
    } return __items; })()).join("");
    check("CJK: executable code remains after removing docstrings", (contains(code_only, "function main")), (String(length(code_only)) + " characters"));
    check("CJK: does not rely on effective.font", (!contains(code_only, "effective")), "Executable code contains effective");
    function run_ensure(script: string, path: string): number | null { return spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: path, HOME: homedir() } }).status; }
    function stub_bin(progs: Record<string, string>): string { const d = mkdtempSync(join(tmp, 'bin-')); for (const [nm, bodysh] of Object.entries(progs)) {
        const fp = join(d, nm);
        writeFileSync(fp, '#!/bin/sh\n' + bodysh + '\n', { mode: 0o755 });
    } return d; }
    check("ensure: missing npx exits 2", (equal(run_ensure(ENSURE, "/usr/bin:/bin"), 2)));
    _d1 = stub_bin({ npx: "exit 0" });
    check("ensure: npx unable to fetch the package exits 1", (equal(run_ensure(ENSURE, (String(_d1) + ":/usr/bin:/bin")), 1)));
    _d0 = stub_bin({ officecli: "echo 9.9.9" });
    check("ensure: OfficeCLI on PATH exits 0", (equal(run_ensure(ENSURE, (String(_d0) + ":/usr/bin:/bin")), 0)));
    check("ensure: all three outcomes are documented", (() => { const __items: any[] = []; for (const m of iterable(["[0]", "[1]", "[2]"])) {
        __items.push((contains(ensure_src, m)));
    } return __items; })().every(truth));
    rows = regexFindall("(?m)^\\|([^|]+)\\|([^|]+)\\|", skill);
    dests = Array.from((() => { const __items: any[] = []; for (const [_, d] of iterable(rows)) {
        __items.push(d);
    } return __items; })()).join(" ");
    check("Routing: .hwpx hands off to hwpx", (truth((contains(dests, "hwpx` skill"))) || truth((contains(dests, "hwpx")))));
    check("Routing: pptx design goes to deck first", (contains(dests, "deck")));
    _router = (test_router?.["run"] ?? null);
    check("Router: tests/test_router.js provides run()", callable(_router), (truth(callable(_router)) ? "" : (_ROUTER_IMPORT_ERROR || "File is empty or run is absent")));
    _before = length(results);
    if (truth(callable(_router))) {
        _router(check, ROOT, skill);
    }
    else {
        _why = (_ROUTER_IMPORT_ERROR || "test_router.js does not provide run()");
        for (i of iterable(range(ROUTER_CHECKS))) {
            check(("Router: contract " + String((i + 1)) + "/" + String(ROUTER_CHECKS)), false, _why);
        }
    }
    check("Router: population matches ROUTER_CHECKS", (equal(subtract(length(results), _before), ROUTER_CHECKS)), (String(subtract(length(results), _before)) + " judgments / declared " + String(ROUTER_CHECKS)));
    rmSync(tmp, { recursive: true, force: true });
    _sections = split_sections(skill);
    _titles = (() => { const __items: any[] = []; for (const t of iterable(_sections)) {
        __items.push(t);
    } return __items; })();
    _want = (() => { const __items: any[] = []; for (const [t, _] of iterable(SECTION_SKELETON)) {
        __items.push(t);
    } return __items; })();
    _gone = (() => { const __items: any[] = []; for (const t of iterable(_want)) {
        if (!truth((!contains(_sections, t))))
            continue;
        __items.push(t);
    } return __items; })();
    check("Body skeleton: all declared section headings exist", (!truth(_gone)), ("missing sections " + String(_gone)));
    _order = (() => { const __items: any[] = []; for (const t of iterable(_titles)) {
        if (!truth((contains(new Set(iterable(_want)), t))))
            continue;
        __items.push(t);
    } return __items; })();
    check("Body skeleton: section order matches the declaration", (equal(_order, _want)), (truth((!equal(_order, _want))) ? ("actual " + String(_order)) : (String(length(_want)) + " sections")));
    _thin = [];
    for ([_t, _toks] of iterable(SECTION_SKELETON)) {
        _bodytxt = (_sections[_t] ?? null);
        if (truth((_bodytxt === null))) {
            continue;
        }
        _miss = (() => { const __items: any[] = []; for (const k of iterable(_toks)) {
            if (!truth((!contains(_bodytxt, k))))
                continue;
            __items.push(k);
        } return __items; })();
        if (truth(_miss)) {
            _thin.push((String(_t.replace(/^## /, "")) + ": " + String(_miss)));
        }
    }
    check("Body skeleton: every section retains minimum content", (!truth(_thin)), ("empty sections " + String(_thin)));
    check_skill_body(check, ROOT, { needles: ["npx --yes @officecli/officecli@latest", "ensure_officecli.js", "Final output is `.hwpx`", "global\nchange", "An unresolved destination fails", "Always `close` (or `save`) before another program reads the file.", "Do not claim the backend is available when it is not.", "Do not run `officecli install`.", "Do not validate through `effective.font`", "Do not duplicate per-format element and property lists here.", "Do not call the output complete before a person opens it.", "Quote paths to prevent shell bracket expansion."], floor: 3120 });
    check_no_constant_assertions(check, __file__);
    live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) {
        if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    check_contract_coverage(check, __file__, ROOT, { per_file: { "SKILL.md": 20 }, live_ran: live_ran });
    check_body_deletion(check, __file__, ROOT, { minimum: 20, extra_strip: [], live_ran: live_ran });
    check_script_contracts(check, __file__, ROOT, { scripts: { "scripts/check_cjk_font.js": 8, "scripts/ensure_officecli.js": 3, "tests/test_router.js": 10 }, live_ran: live_ran });
    check_total(check, results, 51);
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
