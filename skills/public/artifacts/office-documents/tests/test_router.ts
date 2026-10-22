#!/usr/bin/env node
/** Nine routing judgments shared with the owning suite; missing destinations fail closed. */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../../../../runtime/entry.js';
import { split_frontmatter } from '../../../../_suite_lib.js';
const BUILTIN = ['docx', 'xlsx', 'pptx'];
const REFUSED = ['.doc', '.xls', '.ppt'];
const MISSING_SKILL = 'missing-skill';
const EXPECTED_ROUTES = [['formulas', 'xlsx'], ['slide', 'pptx'], ['Report', 'docx'], ['.hwpx', 'hwpx']];
type Check = (name: string, ok: boolean, detail?: string) => void;
function cells(line: string): string[] { return line.trim().replace(/^\|+|\|+$/g, '').split('|').map(c => c.trim()); }
export function parse_routes(text: string): [
    string,
    string
][] {
    const lines = text.split(/\r?\n/), out: [
        string,
        string
    ][] = [];
    for (const [i, line] of lines.entries()) {
        if (!line.trimStart().startsWith('|'))
            continue;
        const head = cells(line);
        if (!head.includes('Signal') || !head.includes('Format'))
            continue;
        if (i + 1 >= lines.length || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]))
            continue;
        const si = head.indexOf('Signal'), fi = head.indexOf('Format');
        for (const body of lines.slice(i + 2)) {
            if (!body.trimStart().startsWith('|'))
                break;
            const c = cells(body);
            if (c.length <= Math.max(si, fi))
                continue;
            out.push([c[si], c[fi]]);
        }
    }
    return out;
}
export function resolve_dest(cell: string, skills_dir: string): [
    string | null,
    string
] {
    const tokens = [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]);
    for (const t of tokens) {
        const name = t.trim().replace(/^\.+/, '');
        if (BUILTIN.includes(name))
            return ['builtin', name];
    }
    for (const t of tokens) {
        const name = t.trim().replace(/^\.+/, '');
        if (new RegExp('`' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\s*\\**\\s*skill').test(cell) || cell.includes('`' + t + '` skill')) {
            try {
                if (statSync(join(skills_dir, name)).isDirectory())
                    return ['skill', name];
            }
            catch { }
            return [MISSING_SKILL, name];
        }
    }
    return [null, cell];
}
export function run(check: Check, root: string, skill_body: string): void {
    const skills_dir = dirname(root), routes = parse_routes(skill_body), dests = routes.map(([, d]) => d);
    check('Router: format table is readable', routes.length >= BUILTIN.length, `${routes.length} rows`);
    const resolved = dests.map(d => resolve_dest(d, skills_dir));
    const counts = Object.fromEntries(BUILTIN.map(b => [b, resolved.filter(([k, n]) => k === 'builtin' && n === b).length]));
    const off = Object.fromEntries(Object.entries(counts).filter(([, c]) => c !== 1));
    check('Router: each of three built-ins is the destination of exactly one row', !Object.keys(off).length, Object.keys(off).length ? `mismatched formats ${JSON.stringify(off)}` : JSON.stringify(counts));
    const unresolved = resolved.filter(([k]) => k === null).map(([, n]) => n);
    check('Router: every destination resolves (fail-closed)', !unresolved.length, `unresolved ${JSON.stringify(unresolved)}`);
    const reroutes = [...new Set(resolved.filter(([k]) => k === 'skill' || k === MISSING_SKILL).map(([, n]) => n))].sort();
    check('Router: at least one handoff destination exists', !!reroutes.length, JSON.stringify(reroutes));
    const missing = [...new Set(resolved.filter(([k]) => k === MISSING_SKILL).map(([, n]) => n))].sort();
    check('Router: handoff destination skills exist', !missing.length, missing.length ? `missing ${JSON.stringify(missing)}` : JSON.stringify(reroutes));
    const kinds = new Set(resolved.map(([k]) => k));
    check('Router: destination kinds are restricted to built-ins and sibling skills', !!kinds.size && [...kinds].every(k => k === 'builtin' || k === 'skill'), `kinds ${JSON.stringify([...kinds].sort((a, b) => String(a).localeCompare(String(b))))}`);
    const blank = routes.filter(([s]) => !s.replace(/[\s*`|-]+/g, '')).map(([, d]) => d);
    check('Router: every row has a signal', !blank.length, `rows without signals ${JSON.stringify(blank)}`);
    const pairs: string[] = [];
    for (const [sig_needle, want] of EXPECTED_ROUTES) {
        const hit = routes.filter(([sg]) => sg.includes(sig_needle)).map(([, d]) => d);
        if (hit.length !== 1) {
            pairs.push(`${sig_needle}->${hit.length} rows`);
            continue;
        }
        const got = resolve_dest(hit[0], skills_dir)[1];
        if (got !== want)
            pairs.push(`${sig_needle}->${got} (expected ${want})`);
    }
    check('Router: signal/destination mapping matches the declaration', !pairs.length, pairs.length ? `mismatches ${JSON.stringify(pairs)}` : `${EXPECTED_ROUTES.length} pairs`);
    const refused_missing = REFUSED.filter(t => !skill_body.includes(t)), silent_ok = skill_body.includes('Do not claim the backend is available when it is not');
    check('Router: unsupported formats are refused by name', !refused_missing.length && silent_ok, refused_missing.length ? `missing refusals ${JSON.stringify(refused_missing)}` : !silent_ok ? 'silent-fallback prohibition is absent' : `refused ${JSON.stringify(REFUSED)}`);
}
function main(): number {
    const root = dirname(dirname(fileURLToPath(import.meta.url))), [, body] = split_frontmatter(readFileSync(join(root, 'SKILL.md'), 'utf8')), res: boolean[] = [];
    run((name, ok, detail = '') => { res.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); }, root, body);
    console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
    return res.every(Boolean) ? 0 : 1;
}
if (isMain(import.meta.url))
    process.exitCode = main();
