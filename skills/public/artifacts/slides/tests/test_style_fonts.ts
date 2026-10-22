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
function regexMatch(pattern: string, text: string): RegExpExecArray | null { const match = regexSearch(pattern, text); return match?.index === 0 ? match : null; }
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
function read(path: string): string { try {
    return readFileSync(path, 'utf8');
}
catch {
    return '';
} }
function stripChars(text: string, chars: string): string { let a = 0, b = text.length; while (a < b && chars.includes(text[a]))
    a++; while (b > a && chars.includes(text[b - 1]))
    b--; return text.slice(a, b); }
const STYLES = join(ROOT, "references", "styles.md");
const KOREAN_FACE = regex("Pretendard|Noto Sans KR|Noto Sans Mono CJK KR|Apple SD Gothic|Malgun|Nanum|D2Coding|본고딕|나눔", "i");
function style_names(text: any): any {
    let m: any, out: any;
    out = [];
    for (m of iterable([...text.matchAll(regex("(?m)^###\\s+([A-Z])\\.\\s+([^(\\n]+)", "g"))])) {
        out.push(m[2].trim());
    }
    return out;
}
function font_map(text: any): any {
    let c: any, cells: any, head: any, i: any, ix_kr: any, ix_name: any, line: any, lines: any, name: any, out: any, row: any;
    cells = (line: any) => (() => { const __items: any[] = []; for (const c of iterable(split(stripChars(line.trim(), "|"), "|"))) {
        __items.push(c.trim());
    } return __items; })();
    lines = text.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== "");
    out = {};
    for ([i, line] of iterable(lines.map((v: any, i: number) => [i, v]))) {
        if (truth((!truth(starts(line.trimStart(), "|"))))) {
            continue;
        }
        head = cells(line);
        if (truth((truth((!contains(head, "Style"))) || truth((!contains(head, "Korean counterpart")))))) {
            continue;
        }
        if (truth((truth(((i + 1) >= length(lines))) || truth((!truth(regexMatch("^\\s*\\|[\\s:|-]+\\|\\s*$", lines[(i + 1)]))))))) {
            continue;
        }
        [ix_name, ix_kr] = [head.indexOf("Style"), head.indexOf("Korean counterpart")];
        for (row of iterable(lines.slice((i + 2)))) {
            if (truth((!truth(starts(row.trimStart(), "|"))))) {
                break;
            }
            c = cells(row);
            if (truth((!equal(length(c), length(head))))) {
                continue;
            }
            name = regexSub("[*`]", "", c[ix_name], "").trim();
            if (truth(name)) {
                out[name] = c[ix_kr];
            }
        }
    }
    return out;
}
function main(): any {
    let _: any, decl: any, f: any, hits: any, kr: any, kr_in_stack: any, mapping: any, mono: any, n: any, names: any, ok: any, passed: any, stack: any, styles: any, uncovered: any;
    styles = read(STYLES);
    check("styles.md is readable", truth(styles.trim()), (String(length(styles)) + "B"));
    hits = [...styles.matchAll(new RegExp(KOREAN_FACE.source, KOREAN_FACE.flags + "g"))].map(m => m[0]);
    check("Korean font names are present", (length(hits) > 0), (String(length(hits)) + " matches"));
    decl = regexSearch("font-family:\\s*([^;}]+)", styles);
    stack = (truth(decl) ? (() => { const __items: any[] = []; for (const f of iterable(split(decl[1], ","))) {
        __items.push(stripChars(f.trim(), "\"'"));
    } return __items; })() : []);
    kr_in_stack = (() => { const __items: any[] = []; for (const f of iterable(stack)) {
        if (!truth(KOREAN_FACE.exec(f)))
            continue;
        __items.push(f);
    } return __items; })();
    check("CJK fonts appear inside the font-family declaration", (length(kr_in_stack) >= 2), (String(kr_in_stack)));
    check("The stack ends with sans-serif fallback", (truth(truth(stack)) && truth((contains(stack.at(-1)!, "sans-serif")))), (truth(stack) ? stack.at(-1)! : "no declaration"));
    names = style_names(styles);
    mapping = font_map(styles);
    check("There are three style sections", (equal(length(names), 3)), (String(names)));
    check("The Korean font mapping table is readable", (length(mapping) >= 1), (String(sorted(mapping))));
    uncovered = (() => { const __items: any[] = []; for (const n of iterable(names)) {
        if (!truth((!truth(KOREAN_FACE.exec((mapping[n] ?? ""))))))
            continue;
        __items.push(n);
    } return __items; })();
    check("Every style has a Korean font counterpart", (truth(names) && truth((!truth(uncovered)))), (truth(uncovered) ? ("unmapped " + String(uncovered)) : (String(length(names)) + "/" + String(length(names)))));
    mono = (() => { const __items: any[] = []; for (const [n, kr] of iterable(Object.entries(mapping))) {
        if (!truth(regexSearch("Mono|Coding", kr, "i")))
            continue;
        __items.push(n);
    } return __items; })();
    check("The monospace style has a Korean monospace counterpart", truth(mono), (String(mono)));
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
