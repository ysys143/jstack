#!/usr/bin/env node
/** Owning skill contracts. Individual assertions and measured deletion floors are preserved. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMain } from '../../../../runtime/entry.js';
import { check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_total, split_frontmatter, check_skill_body, check_ref_contracts, check_body_paths, read_ref, type Result } from '../../../_suite_lib.js';
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
    let body: any, r: any;
    if (truth((!contains(text, head)))) {
        return [];
    }
    body = split(split(text, head, 1)[1], "\n## ", 1)[0];
    return (() => { const __items: any[] = []; for (const r of iterable(regexFindall("(?m)^\\| (?!---)(.+?) \\|", body))) {
        if (!truth((!contains(["The task", "Split", "Case", "Switch", "What the regex does", "Scenario"], r.trim()))))
            continue;
        __items.push(r);
    } return __items; })();
}
function main(): any {
    let _: any, cs: any, eg: any, exc: any, fm: any, missing: any, n: any, named: any, ok: any, passed: any, pz: any, r: any, skill: any, sp: any, sw: any, tbl: any, tiers: any;
    [fm, skill] = split_frontmatter(read(join(ROOT, "SKILL.md")));
    tiers = read(join(ROOT, "references", "tiers.md"));
    exc = read(join(ROOT, "references", "exceptions.md"));
    check("axis: states and rejects the big-task/big-model intuition", (truth((contains(skill, "\"Big task, big model\""))) && truth((contains(skill, "it is wrong twice")))));
    check("axis: provides two counterexamples: long mechanical work and a short locking protocol", (truth((contains(skill, "forty files"))) && truth((contains(skill, "locking protocol")))));
    check("axis: states the replacement axis in one sentence", (contains(skill, "what the task can tolerate being wrong about")));
    check("L0: description declares the tolerance axis", (contains(fm, "error tolerance")));
    check("L0: description explicitly excludes size", (contains(fm, "supported capabilities and evidence")));
    check("L0: description requires recording the reason too", (contains(fm, "record why")));
    tbl = rows(skill, "## The wrong axis");
    check("axis: tier decision table has three rows", (equal(length(tbl), 3)), (String(length(tbl)) + " rows"));
    check("axis: third row is the point", (contains(skill, "the whole point")));
    check("axis: spends capability where downstream checks cannot catch errors", (contains(skill, "the model is the last check")));
    check("axis: tests are the safety net for the middle tier", (contains(skill, "does not have to be the safety net")));
    check("notation: omitted model is inherited invisibly", (truth((contains(skill, "inherits one"))) && truth((contains(skill, "invisible")))));
    check("notation: requires the reason beside the model", (contains(skill, "name why in the same breath")));
    check("notation: provides a concrete example section", (contains(skill, "mechanical rename across the tree")));
    check("notation: without a reason, selection is indistinguishable from default", (contains(skill, "cannot tell a deliberate choice from a")));
    check("notation: reasoned misselection is correctable rather than accidental", (contains(skill, "just happened does not")));
    check("sharding: forbids sharding judgment", (contains(skill, "Do not shard a judgement")));
    check("sharding: partial answers are not coordinated", (contains(skill, "nobody reconciles")));
    check("sharding: the real cost is not tokens", (contains(skill, "never the tokens")));
    check("sharding: task decomposition differs and is usually correct", (contains(skill, "Splitting **work** is different")));
    check("sharding: gives a one-sentence sharding test", (truth((contains(skill, "whether the pieces\ncan be checked separately"))) || truth((contains(skill, "whether the pieces can be checked separately")))));
    sp = rows(tiers, "## The split test");
    check("sharding: sharding test table has four rows", (equal(length(sp), 4)), (String(length(sp)) + " rows"));
    check("sharding: identifies the common half-correct pattern", (truth((contains(tiers, "they split\nthe gathering"))) || truth((contains(tiers, "they split the gathering")))));
    check("names: model names are not capability contracts", (contains(skill, "The model name is not a capability contract")));
    check("names: pinned names age into unmeasured claims", (contains(skill, "nobody re-measured")));
    check("names: centralizes concrete names", (contains(skill, "one file changes")));
    check("names: records measured differences rather than impressions", (contains(skill, "record the measurement next to the name")));
    check("remeasurement: 'X cannot do Y' is a dated measurement", (contains(tiers, "is a measurement with a date on")));
    check("remeasurement: two runs cost less than a year of overspending", (contains(tiers, "cheaper than a year of routing")));
    check("remeasurement: one success is not a rate", (contains(tiers, "One success is not a rate")));
    check("failure: does not degrade uniformly", (contains(skill, "expected not to degrade uniformly")));
    check("failure: lists three failure points", (truth((contains(skill, "held instructions"))) && truth((contains(skill, "multi-step"))) && truth((contains(skill, "contradicts itself")))));
    check("failure: changes task structure rather than tier in those cases", (contains(skill, "restructure the task instead")));
    check("failure: states the goal of reducing state held per step", (contains(skill, "each step holds less")));
    cs = rows(tiers, "## Worked cases");
    check("cases: case table has five rows", (equal(length(cs), 5)), (String(length(cs)) + " rows"));
    check("cases: each row explains why not the adjacent tier", (contains(tiers, "Why not the neighbouring tier")));
    check("cases: concurrency strategy is based on what tests cannot see", (contains(tiers, "where no test looks")));
    check("cases: exception propagation depends on invariants outside local tests", (contains(tiers, "no local test states")));
    check("name axis: defines a separate axis for IDs written in files", (contains(skill, "the name written in the code")));
    check("name axis: states that provider schedules age this axis", (contains(skill, "ages on the provider's schedule")));
    check("name axis: lists three tools intercepted by the hook", (truth((contains(skill, "`Write`, `Edit`, and\n`Bash`"))) || truth((contains(skill, "`Write`, `Edit`, and `Bash`")))));
    check("name axis: states the two-stage block/pass structure", (truth((contains(skill, "blocks the operation"))) && truth((contains(skill, "lets it through")))));
    check("exceptions: project declares exceptions once in pyproject.toml", (truth((contains(skill, "`pyproject.toml`"))) && truth((contains(skill, "stops arguing")))));
    check("paths: does not locate the database by plugin name", (contains(skill, "Never locate that database by plugin name")));
    check("paths: states that failure is silent", (contains(skill, "dies silently")));
    check("paths: uses ${JSTACK_PLUGIN_ROOT} as the alternative", (contains(skill, "${JSTACK_PLUGIN_ROOT}")));
    sw = rows(exc, "## The two switches");
    check("exceptions: switch table has two rows", (equal(length(sw), 2)), (String(length(sw)) + " rows"));
    check("exceptions: names both switch keys", (truth((contains(exc, "approved_legacy_models"))) && truth((contains(exc, "check_model_versions")))));
    check("exceptions: prefers a list before a global bypass", (contains(exc, "Reach for the list first")));
    check("exceptions: requires a reason beside each item", (contains(exc, "Write the reason next to the entry")));
    check("exceptions: unreasoned exceptions accumulate", (contains(exc, "the list only grows")));
    check("exceptions: gives two valid reasons: API-only and reproduction", (truth((contains(exc, "API-only models"))) && truth((contains(exc, "Reproduction")))));
    check("parsing: uses regex rather than a TOML parser", (contains(exc, "not by a TOML parser")));
    pz = rows(exc, "## The file is read by regex");
    check("parsing: result table has four rows", (equal(length(pz), 4)), (String(length(pz)) + " rows"));
    check("parsing: keys are not bound to tables", (contains(exc, "not scoped to `[tool.claude-hooks]`")));
    check("parsing: first pyproject masks the root", (contains(exc, "shadows the repository root")));
    check("parsing: none of the failures is loud", (contains(exc, "None of these fail loudly")));
    check("fail-open: lists paths that fall through to allow", (truth((contains(exc, "fails to import"))) && truth((contains(exc, "any unexpected exception")))));
    check("fail-open: states the cost: broken checker and clean tree are indistinguishable", (contains(exc, "indistinguishable from a clean tree")));
    check("paths: resolves the database relative to the hook", (contains(exc, "relative to itself")));
    check("paths: shows the dead legacy find command", (contains(exc, "plugins/cache/<marketplace>/<plugin>")));
    check("paths: find returns exit 0 with empty output", (contains(exc, "prints nothing and exits 0")));
    check("paths: hard-coded Glob paths have the same defect", (contains(exc, "wearing a different hat")));
    eg = rows(exc, "## Edge cases");
    check("edge cases: table has ten rows", (equal(length(eg), 10)), (String(length(eg)) + " rows"));
    check("edge cases: unregistered IDs pass", (contains(exc, "more likely private or new than retired")));
    check("edge cases: IDs in documentation are also warnings", (contains(exc, "documentation ages the same way")));
    named = new Set(iterable(regexFindall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
    missing = (() => { const __items: any[] = []; for (const n of iterable(named)) {
        if (!truth((!truth(isDir(join(SKILLS, n))))))
            continue;
        __items.push(n);
    } return __items; })();
    check("boundary: handoff target population is nonempty", (length(named) >= 2), (String(sorted(named))));
    check("boundary: all handoff targets exist", (!truth(missing)), ("missing " + String(missing)));
    check("language: description contains Korean triggers", (length(regexFindall("[가-힣]+", fm)) >= 5));
    check("language: description also contains English triggers", (contains(fm, "tier")));
    check_skill_body(check, ROOT, {semantic: true,  needles: ["what the task can tolerate being wrong about", "name why in the same breath", "Do not shard a judgement", "The model name is not a capability contract", "restructure the task instead", "Never locate that database by plugin name"], floor: 2173 });
    check_ref_contracts(check, ROOT, [["tiers.md", "sharding test, case table, and remeasurement contract", ["can each piece be", "Why not the neighbouring tier", "is a measurement with a date on", "One success is not a rate", "Effort and model identity are separate choices", "These roles do not", "authorize spawning agents", "current availability or universal Astra policy"], 1399], ["exceptions.md", "two switches, regex parsing outcomes, fail-open behavior, and database paths", ["Reach for the list first", "not by a TOML parser", "indistinguishable from a clean tree", "Never locate it by plugin name"], 3500]]);
    check_contract_coverage(check, __file__, ROOT, { per_file: { "SKILL.md": 40, "references/tiers.md": 12, "references/exceptions.md": 23 }, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_body_deletion(check, __file__, ROOT, { minimum: 40, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:"])))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_no_constant_assertions(check, __file__);
    check_total(check, results, 90);
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
