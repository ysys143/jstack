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
function table(text: any, head: any): any {
    let body: any, r: any;
    if (truth((!contains(text, head)))) {
        return [];
    }
    body = split(split(text, head, 1)[1], "\n## ", 1)[0];
    return (() => { const __items: any[] = []; for (const r of iterable(regexFindall("(?m)^\\| (?!---)(.+?) \\|", body))) {
        if (!truth((!truth(starts(r.trim(), ["Where", "Family", "Looks like", "|"])))))
            continue;
        __items.push(r);
    } return __items; })();
}
function main(): any {
    let _: any, demoted: any, fam_body: any, fams: any, flat: any, fm: any, fp_body: any, fps: any, gone: any, leaked: any, missing: any, n: any, named: any, nevers: any, ok: any, passed: any, r: any, row: any, rows: any, shapes: any, shapes_path: any, skill: any, steps: any, t: any, verdict: any, why: any;
    [fm, skill] = split_frontmatter(read(join(ROOT, "SKILL.md")));
    shapes_path = join(ROOT, "references", "secret-shapes.md");
    shapes = read_ref(shapes_path);
    check("reference: references/secret-shapes.md exists", (shapes !== null), (truth((shapes !== null)) ? "" : "file missing; its entire contract disappears"));
    shapes = (shapes || "");
    flat = regexSub("\\s+", " ", skill, "");
    check("order: revocation precedes history cleanup", (contains(skill, "Rotate the credential before touching history")));
    check("order: explains why cleanup first is not containment", (truth((contains(skill, "still authenticates"))) && truth((contains(skill, "already cloned")))));
    check("order: chooses revocation when only one action is possible", (contains(skill, "If you can only do one of the two, rotate")));
    check("order: states the asymmetry between the two states", (truth((contains(skill, "dead key is\nsafe"))) || truth((contains(skill, "dead key is safe")))));
    check("order: description also states this order", (/rotate.*first.*history/i.test(fm)));
    rows = table(skill, "## Was it exposed?");
    check("exposure: destination decision table has at least four rows", (length(rows) >= 4), (String(length(rows)) + " rows"));
    for ([row, why, verdict] of iterable([["Staged or committed locally, never pushed", "not pushed", "Not exposed — amend or reset"], ["Pushed to a private remote", "private remote", "Exposed to every reader, every CI cache, every fork"], ["Pushed to a public remote", "public remote", "Compromised. Rotate now, then scrub"], ["Pasted into an issue, PR body, review comment, or chat", "issue or PR", "Compromised, and edits do not remove it"]])) {
        check(("exposure: " + String(why) + " row is paired with its decision"), (contains(skill, ("| " + String(row) + " | " + String(verdict)))));
    }
    check("exposure: states that editing does not erase exposure", (truth((contains(skill, "edits do not remove it"))) && truth((contains(skill, "notification emails")))));
    check("exposure: definition follows where the value traveled, not who observed it", (contains(flat, "Exposure is about where the object travelled, not about whether anyone was watching")));
    check("exposure: ambiguous cases choose the lower bound", (contains(skill, "Take the lower one")));
    check("exposure: explains the asymmetric cost basis", (contains(skill, "cost of a missed one is unbounded")));
    check("deletion: states that the old blob remains reachable", (contains(skill, "still reachable")));
    check("deletion: identifies forks, PR refs, and mirrors as separate copies", (contains(skill, "Forks, pull-request refs, and mirrors are separate")));
    check("deletion: states that force-push does not reach those copies", (contains(skill, "force-push never reaches")));
    steps = regexFindall("(?m)^\\d\\. ", skill);
    check("deletion: three numbered steps exist", (length(steps) >= 3), (String(length(steps)) + " steps"));
    check("deletion: step order is bound to numbers (1=revocation, 2=history, 3=notify forks)", (truth((contains(skill, "1. Rotate at the issuer"))) && truth((contains(skill, "2. Rewrite the history that contains it"))) && truth((contains(skill, "3. Ask the forge to expire cached views")))));
    check("deletion: requires proving the old value fails", (contains(skill, "confirm the old value now fails")));
    check("reference: entry instructions require reading the reference before reporting", (truth((contains(skill, "`references/secret-shapes.md`"))) && truth((contains(skill, "Read that file before reporting anything")))));
    fps = table(shapes, "## False-positive families");
    check("false positives: family table has at least four rows", (length(fps) >= 4), (String(length(fps)) + " rows"));
    check("false positives: states the cost of false reports", (contains(skill, "nobody runs twice")));
    check("false positives: high entropy alone is not a finding", (contains(skill, "High-entropy alone is not a finding")));
    check("false positives: defines discriminators by shape", (truth((contains(shapes, "**discriminator**"))) && truth((contains(shapes, "does not have")))));
    fams = table(shapes, "## Families");
    check("shapes: secret-family table has at least five rows", (length(fams) >= 5), (String(length(fams)) + " rows"));
    check("shapes: states that the public half of a key is not secret", (contains(shapes, "Publishing it is the point")));
    check("shapes: ambiguous candidates are not handled silently", (truth((contains(shapes, "silence reads as"))) && truth((contains(shapes, "never quietly dropped")))));
    check("shapes: private-key discriminator is paired with its report decision", (contains(shapes, "| Private key block | The PEM `BEGIN ... PRIVATE KEY` armour | The armour is unambiguous; report it without further scoring |")));
    check("false positives: row is paired with its decision", (truth((contains(shapes, "| The public half of a keypair | Publishing it is the point |"))) && truth((contains(shapes, "| A content hash, commit SHA, or UUID | High entropy, no issuer, nothing to authenticate against |")))));
    fam_body = split(split(shapes, "## Families", 1).at(-1)!, "\n## ", 1)[0];
    fp_body = split(split(shapes, "## False-positive families", 1).at(-1)!, "\n## ", 1)[0];
    leaked = (() => { const __items: any[] = []; for (const t of iterable(["PRIVATE KEY", "user:password@", "vendor prefix"])) {
        if (!truth((contains(fp_body, t))))
            continue;
        __items.push(t);
    } return __items; })();
    demoted = (() => { const __items: any[] = []; for (const t of iterable(["Publishing it is the point", "nothing to authenticate against"])) {
        if (!truth((contains(fam_body, t))))
            continue;
        __items.push(t);
    } return __items; })();
    check("tables: leak and false-positive families have not crossed tables", (truth((!truth(leaked))) && truth((!truth(demoted)))), ((truth(leaked) ? ("false-positive table contamination " + String(leaked) + " ") : "") + (truth(demoted) ? ("family table contamination " + String(demoted)) : "")));
    check("shapes: does not invent revocation commands", (contains(shapes, "does not invent one")));
    check("shapes: revocation evidence is failure of the old value", (contains(shapes, "not the rotation call returning success")));
    check("gate: .gitignore is not a gate", (contains(skill, "`.gitignore` is not a gate")));
    check("gate: explains why tracked paths are unaffected", (contains(skill, "already tracks")));
    check("gate: provides concrete check and untrack commands", (truth((contains(skill, "git check-ignore -v"))) && truth((contains(skill, "git rm --cached")))));
    check("gate: check-ignore verifies and rm --cached untracks", (truth((contains(skill, "Check with `git check-ignore -v <path>`"))) && truth((contains(skill, "use `git rm --cached` first")))));
    check("gate: directs the check before commit rather than during review", (truth((contains(skill, "pre-commit hook"))) && truth((contains(skill, "already been written to the object database")))));
    nevers = regexFindall("(?m)^- \\*\\*Never ", skill);
    check("prohibitions: at least three Never clauses", (length(nevers) >= 3), (String(length(nevers)) + " clauses"));
    check("prohibitions: sentence forbids committing with intent to fix later", (contains(skill, "- **Never commit a secret to fix later.** There is no later that undoes it.")));
    check("prohibitions: forbids putting the value in a report", (contains(skill, "Never put the secret in the report")));
    check("prohibitions: explains that reports travel farther than files", (contains(skill, "wider distribution than the file did")));
    check("prohibitions: blocks the prefix-only workaround", (contains(skill, "never by prefix long enough to")));
    check("prohibitions: forbids silent revocation and explains why", (truth((contains(skill, "Never rotate silently"))) && truth((contains(skill, "outage you caused")))));
    named = new Set(iterable(regexFindall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
    missing = (() => { const __items: any[] = []; for (const n of iterable(named)) {
        if (!truth((!truth(isDir(join(SKILLS, n))))))
            continue;
        __items.push(n);
    } return __items; })();
    check("boundary: handoff target population is nonempty", (length(named) >= 2), (String(sorted(named))));
    check("boundary: every handoff target exists", (!truth(missing)), ("missing " + String(missing)));
    check("boundary: handoff mapping is correct (audit=quality, cleanup=residue, gitrules=Git reachability)", (truth((contains(flat, "Judging code quality is the `audit` skill"))) && truth((contains(flat, "removing the dead code left behind after a rotation is the `cleanup` skill"))) && truth((contains(flat, "What git can and cannot reach when rewriting history — and the ignore-file mechanics — belong to the `gitrules` skill")))));
    check("boundary: states where this skill stops", (contains(skill, "stops there")));
    check("Language: description names the Korean activation intent", ["시크릿 노출", "API 키"].every(term => fm.includes(term)));
    check("language: description also contains English triggers", (/credential/.test(fm) && /leaks?/i.test(fm)));
    gone = (() => { const __items: any[] = []; for (const t of iterable(["시크릿 노출", "API 키"])) {
        if (!truth((!contains(fm, t))))
            continue;
        __items.push(t);
    } return __items; })();
    check("L0: exposure and API-key activation terms remain", (!truth(gone)), (truth(gone) ? ("missing triggers " + String(gone)) : "exposure and API-key triggers"));
    check_skill_body(check, ROOT, { needles: ["Rotate the credential before touching history", "If you can only do one of the two, rotate", "`.gitignore` is not a gate", "Never put the secret in the report", "Take the lower one"], floor: 2662 });
    check_ref_contracts(check, ROOT, [["secret-shapes.md", "discriminators, family tables, false positives, and revocation evidence", ["**discriminator**", "Publishing it is the point", "silence reads as", "not the rotation call returning success"], 1880]]);
    check_contract_coverage(check, __file__, ROOT, { per_file: { "SKILL.md": 44, "references/secret-shapes.md": 12 }, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_body_deletion(check, __file__, ROOT, { minimum: 44, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_no_constant_assertions(check, __file__);
    check_total(check, results, 71);
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
