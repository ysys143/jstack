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
function subtract(a: any, b: any): any { return a instanceof Set ? new Set([...a].filter(value => !contains(b, value))) : a - b; }
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
function regexSearch(pattern: string, text: string, flags = ''): RegExpExecArray | null { return regex(pattern, flags).exec(text); }
function regexMatch(pattern: string, text: string): RegExpExecArray | null { const match = regexSearch(pattern, text); return match?.index === 0 ? match : null; }
function regexFullmatch(pattern: string, text: string): RegExpExecArray | null { return regexSearch(`^(?:${pattern})$`, text); }
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
function main(): any {
    let PLUGIN: any, ROW_RE: any, STOP: any, TRIGGERS: any, _: any, a: any, agents: any, b: any, body: any, broken: any, catalog: any, catalog_commands: any, catalog_path: any, catalog_skills: any, cmds: any, corpus: any, d: any, dangling: any, dbroken: any, deletion_meta: any, derived: any, disk_commands: any, f: any, flat: any, fm: any, gone: any, graph: any, k: any, label: any, left: any, lefts: any, line: any, ln: any, m: any, mapped: any, misranked: any, n: any, name: any, named: any, ok: any, on_disk: any, other_fm: any, own: any, pairs: any, passed: any, quoted: any, r: any, rank: any, raw: any, rows: any, sections: any, sent: any, skill: any, sp: any, t: any, tgt: any, top1: any, total_hits: any, trig: any, v: any, weak: any, words: any, x: any, y: any;
    [fm, skill] = split_frontmatter(read(join(ROOT, "SKILL.md")));
    flat = regexSub("\\s+", " ", skill, "");
    mapped = regexFindall("(?m)^\\| .+ \\| `([a-z][a-z0-9-]+)` \\|$", skill);
    on_disk = sorted((() => { const __items: any[] = []; for (const d of iterable(readdirSync(SKILLS))) {
        if (!truth((truth(isDir(join(SKILLS, d))) && truth(existsSync(join(SKILLS, d, "SKILL.md"))))))
            continue;
        __items.push(d);
    } return __items; })());
    check("Map: has at least one entry", (length(mapped) > 0), (String(length(mapped)) + " entries"));
    check("Map: every mapped skill exists", (() => { const __items: any[] = []; for (const m of iterable(mapped)) {
        __items.push((contains(on_disk, m)));
    } return __items; })().every(truth), ("absent " + String((() => { const __items: any[] = []; for (const m of iterable(mapped)) {
        if (!truth((!contains(on_disk, m))))
            continue;
        __items.push(m);
    } return __items; })())));
    check("Map: every skill in the tree is mapped", (() => { const __items: any[] = []; for (const d of iterable(on_disk)) {
        __items.push((contains(mapped, d)));
    } return __items; })().every(truth), ("missing " + String((() => { const __items: any[] = []; for (const d of iterable(on_disk)) {
        if (!truth((!contains(mapped, d))))
            continue;
        __items.push(d);
    } return __items; })())));
    check("Map: has no duplicate entries", (equal(length(mapped), length(new Set(iterable(mapped))))), (String((() => { const __items: any[] = []; for (const m of iterable(new Set(iterable(mapped)))) {
        if (!truth((count(mapped, m) > 1)))
            continue;
        __items.push(m);
    } return __items; })())));
    check("Map: left column contains situations rather than names", (() => { const __items: any[] = []; for (const r of iterable(regexFindall("(?m)^\\| (.+?) \\| `[a-z-]+` \\|$", skill))) {
        __items.push((!truth(regexFullmatch("`?[a-z-]+`?", r.trim()))));
    } return __items; })().every(truth));
    check("Map: includes itself, proving the roster is complete", (contains(mapped, "help")));
    check("Rationale: says a name list does not identify applicability", (contains(skill, "does not tell you which one applies")));
    check("Rationale: says people arrive with situations", (contains(skill, "arrive with is a situation")));
    check("Rationale: says the name is the answer, never the question", (contains(skill, "never the question")));
    check("Rationale: says the map is checked against the tree", (contains(skill, "checked against the tree")));
    check("Rationale: says a stale map is worse than no map", (contains(skill, "worse than no map")));
    check("Rationale: explains why: it answers confidently", (contains(skill, "answers confidently")));
    check("Absence: instructs the agent to say when nothing applies", (contains(skill, "Say so plainly")));
    check("Absence: requires stating what the request needs", (contains(skill, "what the request would need")));
    check("Absence: says routing to the nearest skill is worse", (contains(skill, "worse than answering directly")));
    check("Absence: says that mismatch is invisible in output", (contains(skill, "invisible in the output")));
    check("Absence: forbids redirecting to an uninstalled target", (contains(skill, "user has not installed")));
    check("Absence: states the plugin self-sufficiency principle", (contains(skill, "sufficient on its own")));
    check("Conflict: instructs the agent to read both boundary sentences", (contains(skill, "Read both boundary sentences")));
    check("Conflict: says overlapping skills name their relevant neighbours", (contains(skill, "skills with overlapping activation name the\nrelevant neighbour")));
    check("Conflict: gives a concrete commonly confused pair", (contains(skill, "`audit` and `cleanup`")));
    check("Conflict: gives the distinction in one sentence", (contains(skill, "judging changes nothing")));
    check("Conflict: says an unresolved boundary is defective", (contains(skill, "the boundary is wrong")));
    check("Conflict: identifies where to fix that defect", (contains(skill, "`author` covers fixing it")));
    graph = {};
    for (d of iterable(sorted(readdirSync(SKILLS)))) {
        sp = join(SKILLS, d, "SKILL.md");
        if (truth((!truth(isFile(sp))))) {
            continue;
        }
        body = split_frontmatter(read(sp))[1];
        graph[d] = new Set(iterable(regexFindall("`([a-z][a-z0-9-]+)`\\s*\\n?\\s*(?:skill|command)", body)));
    }
    check("Graph: every on-disk skill is in the boundary graph population", (equal(new Set(iterable(graph)), new Set(iterable(on_disk)))), ("graph=" + String(length(graph)) + ", disk=" + String(length(on_disk))));
    dangling = sorted(new Set((() => { const __items: any[] = []; for (const [k, v] of iterable(Object.entries(graph))) {
        for (const n of iterable(v)) {
            if (!truth((truth((!contains(graph, n))) && truth((!truth(existsSync(join(dirname(SKILLS), "commands", (n + ".md")))))))))
                continue;
            __items.push([k, n]);
        }
    } return __items; })()));
    check("Graph: every named neighbour exists as a skill or command", (!truth(dangling)), (String(dangling)));
    pairs = [["secrets", "gitrules"], ["audit", "consult"], ["audit", "cleanup"], ["audit", "verify"]];
    broken = (() => { const __items: any[] = []; for (const [a, b] of iterable(pairs)) {
        if (!truth((!truth((truth((contains((graph[a] ?? []), b))) && truth((contains((graph[b] ?? []), a))))))))
            continue;
        __items.push([a, b]);
    } return __items; })();
    check("Graph: overlapping-trigger pairs refer to each other", (!truth(broken)), (String(broken)));
    check("Graph: declares at least four bidirectional pairs", (length(pairs) >= 4), (String(length(pairs)) + " pairs"));
    function _norm(t: any): any {
        t = regexSub("(해줘|해라|하라|해|줘|봐|줄래|알려|보자)$", "", t.trim(), "");
        t = regexSub("(을|를|이|가|은|는|에|의|로|으로)$", "", t, "");
        return regexSub("\\s+", " ", t, "").trim();
    }
    trig = {};
    for (d of iterable(graph)) {
        other_fm = split_frontmatter(read(join(SKILLS, d, "SKILL.md")))[0];
        m = regexSearch("(?:Triggers|트리거)\\s*[:—]\\s*(.+?)(?:\\.\\s|$)", other_fm, "s");
        trig[d] = (truth(m) ? new Set((() => { const __items: any[] = []; for (const t of iterable(m[1].split(",").map((term: string) => term.trim().replace(/^[\"]|[\".]+$/g, "")))) {
            __items.push(_norm(t));
        } return __items; })()) : new Set());
        trig[d] = new Set((() => { const __items: any[] = []; for (const t of iterable(trig[d])) {
            if (!truth((length(t.replaceAll(" ", "")) >= 2)))
                continue;
            __items.push(t);
        } return __items; })());
    }
    function _overlaps(x: any, y: any): any {
        let long: any, short: any;
        if (truth((equal(x, y)))) {
            return true;
        }
        [short, long] = (truth((length(x) < length(y))) ? [x, y] : [y, x]);
        if (truth((truth((length(short) < 3)) || truth((!truth(starts(long, short))))))) {
            return false;
        }
        return (equal(long[length(short)], " "));
    }
    derived = new Set();
    for (a of iterable(sorted(trig))) {
        for (b of iterable(sorted(trig))) {
            if (truth((a >= b))) {
                continue;
            }
            if (truth((() => { const __items: any[] = []; for (const x of iterable(trig[a])) {
                for (const y of iterable(trig[b])) {
                    __items.push(_overlaps(x, y));
                }
            } return __items; })().some(truth))) {
                derived.add([a, b]);
            }
        }
    }
    check("Graph: trigger normalization handles colon, dash and Korean request suffixes", trig.audit.has("코드 리뷰") && trig.models.has("모델 선택") && _norm("검증해줘") === "검증", (String(sorted(derived))));
    dbroken = sorted((() => { const __items: any[] = []; for (const [a, b] of iterable(derived)) {
        if (!truth((!truth((truth((contains((graph[a] ?? []), b))) && truth((contains((graph[b] ?? []), a))))))))
            continue;
        __items.push([a, b]);
    } return __items; })());
    check("Graph: every derived overlap is bidirectional", (!truth(dbroken)), (String(dbroken)));
    check("Self-application: help has a Boundary section", (contains(skill, "\n## Boundary")));
    check("Self-application: says it routes and stops", (contains(skill, "routes and stops")));
    check("Self-application: forbids replacing invocation with a summary", (contains(skill, "in place of firing it")));
    check("Self-application: explains that a summary is not the judgement", (truth((contains(skill, "is not the\njudgement"))) || truth((contains(skill, "is not the judgement")))));
    check("Self-application: routes map gaps to author", (contains(skill, "`author` skill")));
    named = new Set(iterable(regexFindall("`([a-z][a-z0-9-]{2,})`\\s*skill", skill)));
    check("Self-application: every named neighbour exists", (() => { const __items: any[] = []; for (const n of iterable(named)) {
        __items.push(isDir(join(SKILLS, n)));
    } return __items; })().every(truth), (String(sorted(named))));
    check("Language: description has Korean triggers", (length(regexFindall("[가-힣]+", fm)) >= 5));
    check("Language: description has English triggers", (truth((contains(fm, "help"))) && truth((contains(fm, "what can you do")))));
    check("L0: description states the routing axis as a decision, not a name", (contains(fm, "not by its name")));
    check("L0: description promises a nothing-applies response", (contains(fm, "when nothing here covers it")));
    ROW_RE = "(?m)^\\| (.+?) \\| `([a-z][a-z0-9-]+)` \\|$";
    rows = regexFindall(ROW_RE, skill);
    STOP = new Set(["what", "that", "with", "this", "when", "from", "into", "your", "here", "does", "than", "then", "they", "them", "their", "have", "been", "will", "which", "without", "before", "after", "actually", "something", "whose", "must", "make", "take", "hand", "more", "over", "ready", "work", "using", "onto", "only", "also"]);
    function content_words(s: any): any {
        let w: any;
        return new Set((() => { const __items: any[] = []; for (const w of iterable(regexFindall("[a-z]+", s.toLowerCase()))) {
            if (!truth((truth((length(w) >= 4)) && truth((!contains(STOP, w))))))
                continue;
            __items.push(w);
        } return __items; })());
    }
    corpus = {};
    for (d of iterable(sorted(readdirSync(SKILLS)))) {
        sp = join(SKILLS, d, "SKILL.md");
        if (truth((!truth(isFile(sp))))) {
            continue;
        }
        raw = read(sp);
        corpus[d] = Array.from((() => { const __items: any[] = []; for (const ln of iterable(raw.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
            if (!truth((!truth(regexMatch(ROW_RE.replaceAll("(?m)", ""), ln)))))
                continue;
            __items.push(ln);
        } return __items; })()).join("\n").toLowerCase();
    }
    function score(words: any, d: any): any {
        let w: any;
        return (() => { const __items: any[] = []; for (const w of iterable(words)) {
            if (!truth((contains((corpus[d] ?? ""), w))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    }
    [weak, misranked, top1, total_hits] = [[], [], 0, 0];
    for ([left, tgt] of iterable(rows)) {
        words = content_words(left);
        own = score(words, tgt);
        total_hits += own;
        rank = ((() => { const __items: any[] = []; for (const d of iterable(corpus)) {
            if (!truth((score(words, d) > own)))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) + 1);
        if (truth((own < 1))) {
            weak.push([left.slice(0, 34), tgt, own]);
        }
        if (truth((rank > 2))) {
            misranked.push([left.slice(0, 34), tgt, rank]);
        }
        if (truth((equal(rank, 1)))) {
            top1 += 1;
        }
    }
    check("Index: map row population is nonempty", (length(rows) >= 15), (String(length(rows)) + " rows"));
    check("Index: each left-hand side shares keywords with its target skill", (truth(truth(rows)) && truth((!truth(weak)))), ("zero shared terms " + String(weak)));
    check("Index: every target skill ranks in the top two", (truth(truth(rows)) && truth((!truth(misranked)))), ("misranked rows " + String(misranked)));
    check("Index: at least 17 rows rank their target first", (top1 >= 17), (String(top1) + " rows"));
    check("Index: total left-side-to-skill matching tokens is at least 57", (total_hits >= 57), (String(total_hits) + " matches"));
    lefts = (() => { const __items: any[] = []; for (const [left, _] of iterable(rows)) {
        __items.push(left.trim());
    } return __items; })();
    check("Index: left-hand sides have no duplicates", (truth(truth(lefts)) && truth((equal(length(new Set(iterable(lefts))), length(lefts))))), ("duplicates " + String(sorted(new Set((() => { const __items: any[] = []; for (const x of iterable(lefts)) {
        if (!truth((count(lefts, x) > 1)))
            continue;
        __items.push(x);
    } return __items; })())))));
    PLUGIN = dirname(SKILLS);
    cmds = (truth(isDir(join(PLUGIN, "commands"))) ? sorted((() => { const __items: any[] = []; for (const f of iterable(readdirSync(join(PLUGIN, "commands")))) {
        if (!truth(f.endsWith(".md")))
            continue;
        __items.push(f);
    } return __items; })()) : []);
    agents = (truth(isDir(join(PLUGIN, "agents"))) ? sorted((() => { const __items: any[] = []; for (const f of iterable(readdirSync(join(PLUGIN, "agents")))) {
        if (!truth(f.endsWith(".md")))
            continue;
        __items.push(f);
    } return __items; })()) : []);
    check("Population: commands exist", (length(cmds) > 0), (String(length(cmds)) + " commands"));
    check("Population: agents exist", (length(agents) > 0), (String(length(agents)) + " agents"));
    check("Population: says the map contains skills only", (contains(flat, "The map indexes **skills, and only skills**.")));
    check("Population: explains why commands are excluded", (truth((contains(flat, "Commands are explicit entry points"))) && truth((contains(flat, "/jstack:test-plugin")))));
    check("Population: explains why agents are excluded", (contains(flat, "An agent is never chosen by the user at all")));
    check("Population: names where to go for a roster", (contains(flat, "the `skills` command reads the tree and prints all three layers")));
    check("Population: the named command exists", isFile(join(PLUGIN, "commands", "skills.md")));
    catalog_path = join(PLUGIN, "CAPABILITIES.md");
    catalog = (truth(isFile(catalog_path)) ? read(catalog_path) : "");
    catalog_skills = new Set([...catalog.matchAll(/^\| `([a-z][a-z0-9-]+)` \|/gm)].map(match => match[1]));
    check("카탈로그: help identifies the canonical feature catalog at the install root", (truth((contains(skill, "../../CAPABILITIES.md"))) && truth((contains(skill, "${JSTACK_PLUGIN_ROOT}/CAPABILITIES.md")))));
    check("카탈로그: the capability table covers every source owner, including conditional support", (equal(catalog_skills, new Set(iterable(on_disk)))), ("missing " + String(sorted(subtract(new Set(iterable(on_disk)), catalog_skills))) + ", extra " + String(sorted(subtract(catalog_skills, new Set(iterable(on_disk)))))));
    catalog_commands = new Set(iterable(regexFindall("`/([a-z][a-z0-9-]+)`", split(catalog, "Claude Code exposes", 1).at(-1)!)));
    disk_commands = new Set((() => { const __items: any[] = []; for (const name of iterable(cmds)) {
        __items.push([basename(name, extname(name)), extname(name)][0]);
    } return __items; })());
    check("카탈로그: 35 public commands match the actual command files", (truth((equal(length(catalog_commands), 35))) && truth((equal(catalog_commands, disk_commands)))), ("catalog=" + String(length(catalog_commands)) + ", disk=" + String(length(disk_commands))));
    check("Examples: explains the different outcomes of the two setup commands", (truth((contains(skill, "prepares project recall"))) && truth((contains(skill, "Google Workspace installation and OAuth")))));
    check("Examples: distinguishes test-plugin, validate, and doctor targets", (truth((contains(skill, "runs plugin contracts"))) && truth((contains(skill, "validates an artifact"))) && truth((contains(skill, "diagnoses without\nchanging the project")))));
    TRIGGERS = ["뭐 할 수 있어", "어떤 스킬", "도움말", "목록", "help", "what can you do", "스킬 알려줘", "이럴 땐 뭘 써"];
    gone = (() => { const __items: any[] = []; for (const t of iterable(TRIGGERS)) {
        if (!truth((!contains(fm, ("\"" + String(t) + "\"")))))
            continue;
        __items.push(t);
    } return __items; })();
    check("L0: every declared trigger phrase survives literally", (!truth(gone)), ("absent " + String(gone)));
    quoted = regexFindall("\"([^\"]+)\"", fm);
    check("L0: has at least eight trigger phrases", (length(quoted) >= 8), (String(length(quoted)) + " triggers"));
    sections = regexFindall("(?m)^## (.+)$", skill);
    check("Skeleton: section headings retain their declared order", (equal(sections, ["Why a map and not a list", "The map", "Commands are explicit entry points", "When nothing here applies", "Two skills seem to apply", "Boundary"])), (String(sections)));
    for ([label, sent] of iterable([["why a map rather than a list", "A list of names tells you what exists; it does not tell you which one applies."], ["map is checked against the tree", "This map is checked against the tree: every skill here exists, and every skill in the plugin appears here."], ["why a stale map is worse", "A map that drifts is worse than no map, because it answers confidently."], ["nothing-applies response", "Say so plainly, and say what the request would need."], ["self-sufficiency", "This plugin is meant to be sufficient on its own for the work it names."], ["resolve conflicts through boundary sentences", "Read both boundary sentences; skills with overlapping activation name the relevant neighbour and say what belongs to it."], ["unresolved boundary is defective", "If the boundaries genuinely do not settle it, the boundary is wrong — that is a defect in the descriptions, and `author` covers fixing it."], ["route and stop", "This skill routes and stops. It does not do the work it points at, and it does not summarise a skill in place of firing it"]])) {
        check(("Sentence: " + String(label) + " appears verbatim"), (contains(flat, sent)), (truth((contains(flat, sent))) ? "" : ("missing: " + String(sent.slice(0, 46)) + "...")));
    }
    check_skill_body(check, ROOT, { needles: ["never the question", "worse than no map", "worse than answering directly", "Read both boundary sentences", "sufficient on its own"], floor: 3796 });
    deletion_meta = ["자기검사:", "계약 커버리지:", "카탈로그:"];
    check_contract_coverage(check, __file__, ROOT, { per_file: { "SKILL.md": 56 }, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], deletion_meta)))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_body_deletion(check, __file__, ROOT, { minimum: 56, live_ran: (() => { const __items: any[] = []; for (const r of iterable(results)) {
            if (!truth((!truth(starts(r[0], deletion_meta)))))
                continue;
            __items.push(1);
        } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) });
    check_no_constant_assertions(check, __file__);
    check_total(check, results, 84);
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
