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
function regexFullmatch(pattern: string, text: string): RegExpExecArray | null { return regexSearch(`^(?:${pattern})$`, text); }
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
const SLOP = join(ROOT, "references", "design-slop.md");
const CAUSE_TAGS = ["input", "no-verify"];
const AXIS_COLUMNS = ["감점", "비용"];
function cells(line: any): any {
    let c: any;
    return (() => { const __items: any[] = []; for (const c of iterable(split(stripChars(line.trim(), "|"), "|"))) {
        __items.push(c.trim());
    } return __items; })();
}
function tables(text: any): any {
    let head: any, i: any, line: any, lines: any, out: any, row: any, rows: any;
    lines = text.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== "");
    out = [];
    for ([i, line] of iterable(lines.map((v: any, i: number) => [i, v]))) {
        if (truth((!truth(starts(line.trimStart(), "|"))))) {
            continue;
        }
        if (truth((truth(((i + 1) >= length(lines))) || truth((!truth(regexMatch("^\\s*\\|[\\s:|-]+\\|\\s*$", lines[(i + 1)]))))))) {
            continue;
        }
        head = cells(line);
        rows = [];
        for (row of iterable(lines.slice((i + 2)))) {
            if (truth((!truth(starts(row.trimStart(), "|"))))) {
                break;
            }
            rows.push(cells(row));
        }
        out.push([head, rows]);
    }
    return out;
}
function _tag_column(head: any, rows: any, want_items: any): any {
    let c: any, ix: any, m: any, out: any;
    if (truth((!contains(head, "Tag")))) {
        return [];
    }
    if (truth((!equal(truth((truth(head) && truth((equal(head[0], "#"))))), want_items)))) {
        return [];
    }
    ix = head.indexOf("Tag");
    out = [];
    for (c of iterable(rows)) {
        if (truth((!equal(length(c), length(head))))) {
            continue;
        }
        m = regexFullmatch("`([a-z][a-z0-9-]*)`", c[ix]);
        if (truth(m)) {
            out.push(m[1]);
        }
    }
    return out;
}
function declared_tags(text: any): any {
    let head: any, out: any, rows: any;
    out = [];
    for ([head, rows] of iterable(tables(text))) {
        out.push(..._tag_column(head, rows, false));
    }
    return out;
}
function used_tags(text: any): any {
    let head: any, out: any, rows: any;
    out = [];
    for ([head, rows] of iterable(tables(text))) {
        out.push(..._tag_column(head, rows, true));
    }
    return out;
}
function item_tables(text: any): any {
    let h: any, r: any;
    return (() => { const __items: any[] = []; for (const [h, r] of iterable(tables(text))) {
        if (!truth((truth(h) && truth((equal(h[0], "#"))))))
            continue;
        __items.push([h, r]);
    } return __items; })();
}
function main(): any {
    let _: any, _rows: any, a: any, c: any, filled: any, h: any, head: any, i: any, items: any, ix: any, joined: any, ok: any, passed: any, rows: any, slop: any, tabled: any, tags: any, total: any, undefined: any, used: any;
    slop = read(SLOP);
    check("design-slop.md is readable", truth(slop.trim()), (String(length(slop)) + "B"));
    tags = declared_tags(slop);
    check("[C-43] Cause tags have exactly two values", (equal(sorted(new Set(iterable(tags))), sorted(CAUSE_TAGS))), ("declared " + String(sorted(new Set(iterable(tags)))) + " / canonical " + String(sorted(CAUSE_TAGS))));
    check("The cause-tag definition table has no duplicates", (truth(truth(tags)) && truth((equal(length(tags), length(new Set(iterable(tags))))))), (String(length(tags)) + " rows / " + String(length(new Set(iterable(tags)))) + " values"));
    used = used_tags(slop);
    undefined = sorted(subtract(new Set(iterable(used)), new Set(iterable(tags))));
    check("All item tags are in the definition table", (truth(truth(used)) && truth((!truth(undefined)))), (truth(undefined) ? ("undefined " + String(undefined)) : (String(length(used)) + " items / " + String(length(new Set(iterable(used)))) + " values")));
    items = item_tables(slop);
    check("Item tables are readable", truth(items), (String(length(items)) + " tables"));
    tabled = [];
    for ([head, _rows] of iterable(items)) {
        joined = Array.from(head).join(" ");
        tabled.push((() => { const __items: any[] = []; for (const a of iterable(AXIS_COLUMNS)) {
            __items.push((contains(joined, a)));
        } return __items; })().every(truth));
    }
    check("[C-43] Every item table has both impact and cost columns", (truth(truth(tabled)) && truth(tabled.every(truth))), (truth(tabled) ? (String(tabled.reduce((sum: number, value: any) => sum + Number(value), 0)) + "/" + String(length(tabled)) + " tables") : "no item tables"));
    [filled, total] = [0, 0];
    for ([head, rows] of iterable(items)) {
        joined = Array.from(head).join(" ");
        if (truth((!truth((() => { const __items: any[] = []; for (const a of iterable(AXIS_COLUMNS)) {
            __items.push((contains(joined, a)));
        } return __items; })().every(truth))))) {
            continue;
        }
        ix = (() => { const __items: any[] = []; for (const [i, h] of iterable(head.map((v: any, i: number) => [i, v]))) {
            if (!truth((() => { const __items: any[] = []; for (const a of iterable(AXIS_COLUMNS)) {
                __items.push((contains(h, a)));
            } return __items; })().some(truth)))
                continue;
            __items.push(i);
        } return __items; })();
        for (c of iterable(rows)) {
            if (truth((!equal(length(c), length(head))))) {
                continue;
            }
            total += 1;
            if (truth((() => { const __items: any[] = []; for (const i of iterable(ix)) {
                __items.push(c[i]);
            } return __items; })().every(truth))) {
                filled += 1;
            }
        }
    }
    check("[C-43] Every item has values for both axes", (truth((total > 0)) && truth((equal(filled, total)))), (String(filled) + "/" + String(total) + " items"));
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
