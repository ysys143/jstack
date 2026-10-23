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
function sorted(value: any): any[] { return [...iterable(value)].sort((a: any, b: any) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0); }
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
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
function read(path: string): string { return readFileSync(path, 'utf8'); }
function stripChars(text: string, chars: string): string { let a = 0, b = text.length; while (a < b && chars.includes(text[a]))
    a++; while (b > a && chars.includes(text[b - 1]))
    b--; return text.slice(a, b); }
function zip(...arrays: any[][]): any[][] { return Array.from({ length: Math.min(...arrays.map(a => a.length)) }, (_, i) => arrays.map(a => a[i])); }
function pyOr(...values: any[]): any { return values.find(truth) ?? values.at(-1); }
function intersection(a: Set<any>, b: Set<any>): Set<any> { return new Set([...a].filter(v => b.has(v))); }
const SCRIPTS = join(ROOT, "scripts");
const NANO = join(SCRIPTS, "nanobanana.py");
const PROBE = join(SCRIPTS, "probe_backends.js");
const CLI_MD = join(ROOT, "references", "cli.md");
const PROMPTS_MD = join(ROOT, "references", "prompts.md");
const CANON_SLOTS = ["Use case", "Asset type", "Output target", "Primary request", "Scene/backdrop", "Subject", "Style/medium", "Composition/framing", "Text (verbatim, large labels only)", "Constraints", "Avoid", "Color palette"];
const TAG_LITERALS = ["`median`", "`underspec`", "`no-constraint`", "`no-verify`", "`input`"];
const CANON_ROWS = [["1", "`Use case`", "Placement: proposal cover, presentation background, document illustration", "A purposeless image is cropped when placed in the intended location"], ["2", "`Asset type`", "Asset kind: hero / icon / illustration / background / thumbnail", "The spacing convention specific to that asset kind is not enforced"], ["3", "`Output target`", "Final dimensions and medium: 16:9 slide / A4 print / square thumbnail", "The model chooses its default aspect ratio; cropping cuts off the subject"], ["4", "`Primary request`", "A one-sentence request. Only this slot is required", "The other ten slots have no request to qualify"], ["5", "`Scene/backdrop`", "Background, setting, and environment", "Gray gradients or purple-blue backgrounds become defaults"], ["6", "`Subject`", "Main subject and its state", "Only the background appears, or multiple subjects compete"], ["7", "`Style/medium`", "Visual style and medium: flat vector / photograph / line art / watercolor", "Default glossy 3D rendering clashes with the document's tone"], ["8", "`Composition/framing`", "Composition, viewpoint, and space: centered / left third / top clearance", "The subject fills the center, leaving no room for the title"], ["9", "`Text (verbatim, large labels only)`", "**Exact lettering** to include; large labels only", "The model invents unreadable pseudo-characters"], ["10", "`Constraints`", "Requirements: monochrome readability / minimum text size / safe margins", "Violations cannot be identified as failures without stated constraints"], ["11", "`Avoid`", "Exclusions: logos, human faces, specific colors", "Shapes resembling the procuring institution's logo can appear"], ["12", "`Color palette`", "**Hero only.** Specify exact color values", "Cover colors vary between runs, breaking consistency across the materials"]];
const SLOT_HEADER = ["#", "Slot", "What to specify", "What happens if omitted"];
const JOIN_HEADER = ["This document", "Joined category"];
const JOIN_ROWS = [["A slot among 1-11 (12) was empty", "Missing prompt information; fix it by **filling that slot**"], ["All slots were filled, but the result was not inspected", "Generation without verification; fix it by **rendering and visually inspecting**"]];
const PATHARG_HEADER = ["Slot", "codex path", "nanobanana path"];
const PATHARG_ROWS = [["Slot 3 `Output target`: aspect ratio", "State it in prose; control is weaker", "Pass `-a/--aspect-ratio`"], ["Slot 3 `Output target`: size", "State it in prose", "Pass `-s/--size`"], ["All remaining slots", "Join into one paragraph", "Join into one positional argument"]];
const BOUNDARY_HEADER = ["Target", "Owner", "What image must not do"];
const BOUNDARY_ROWS = [["Structured diagrams: architecture, flows, and relationships", "`diagram`", "Rasterize editable lines and labels"], ["Slide typesetting and layout", "`deck`", "Bake body text into an image"], ["Raster image generation and editing", "`image`", "—"]];
const CLIARG_HEADER = ["Argument", "Form", "Value", "Description"];
function skills_dir_of(skill_root: any): any {
    return dirname(skill_root);
}
function flat(text: any): any {
    return regexSub("\\s+", " ", text, "");
}
function parse_md_table(text: any, header: any): any {
    let b: any, c: any, cells: any, i: any, lines: any, ln: any, rows: any;
    cells = (ln: any) => (() => { const __items: any[] = []; for (const c of iterable(split(stripChars(ln.trim(), "|"), "|"))) {
        __items.push(c.trim());
    } return __items; })();
    lines = text.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== "");
    for ([i, ln] of iterable(lines.map((v: any, i: number) => [i, v]))) {
        if (truth((!truth(starts(ln.trimStart(), "|"))))) {
            continue;
        }
        if (truth((!equal(cells(ln), header)))) {
            continue;
        }
        if (truth(pyOr(((i + 1) >= length(lines)), (!truth(regexMatch("^\\s*\\|[\\s:|-]+\\|\\s*$", lines[(i + 1)])))))) {
            continue;
        }
        rows = [];
        for (b of iterable(lines.slice((i + 2)))) {
            if (truth((!truth(starts(b.trimStart(), "|"))))) {
                break;
            }
            rows.push(cells(b));
        }
        return rows;
    }
    return null;
}
function row_diff(rows: any, canon: any): any {
    let bad: any, g: any, got: any, i: any, j: any, w: any, want: any;
    if (truth((rows === null))) {
        return ["Table absent (header mismatch)"];
    }
    if (truth((!equal(length(rows), length(canon))))) {
        return [("row count " + String(length(rows)) + " != " + String(length(canon)))];
    }
    bad = [];
    for ([i, [got, want]] of iterable(zip(rows, canon).map((v: any, i: number) => [i, v]))) {
        if (truth((!equal(length(got), length(want))))) {
            bad.push(("r" + String((i + 1)) + ": column count " + String(length(got)) + " != " + String(length(want))));
            continue;
        }
        for ([j, [g, w]] of iterable(zip(got, want).map((v: any, i: number) => [i, v]))) {
            if (truth((!equal(g, w)))) {
                bad.push(("r" + String((i + 1)) + "c" + String((j + 1))));
            }
        }
    }
    return bad;
}
function run_probe(path: string, home: string, key?: string | null, cwd = SCRIPTS): [
    number | null,
    string
] { const env: NodeJS.ProcessEnv = { PATH: path, HOME: home }; if (key)
    env.GEMINI_API_KEY = key; const r = spawnSync(process.execPath, [PROBE], { encoding: 'utf8', env, cwd }); return [r.status, r.stdout ?? '']; }
function main(): any {
    let EXCUSED: any, G_NEEDLES: any, KEY_NEEDLES: any, LEN_NEEDLES: any, MARKED: any, NAME: any, ORDER_NEEDLES: any, PAIR: any, SKILL_LEN_NEEDLES: any, SLOT_CLAIMS: any, _: any, _excused: any, _fake: any, _skill_raw: any, _stale: any, a: any, args: any, b: any, bad3: any, bad4: any, base_slots: any, bdiff: any, body: any, bound_rows: any, c: any, c3: any, c4: any, ch: any, cli: any, cli_rows: any, cmd: any, codex: any, codex_col: any, decl: any, declared: any, doc_opts: any, dup: any, ex_bad: any, ex_pairs: any, flat_cli: any, flat_prompts: any, found: any, g: any, g_decl: any, gen_gate: any, ghost: any, ghost_owners: any, hero_rows: any, home: any, jdiff: any, join_rows: any, key: any, keys: any, lab: any, label: any, live_ran: any, m: any, m2: any, m_ssot: any, malformed: any, miss_g: any, miss_key: any, miss_len: any, miss_order: any, miss_slen: any, missing: any, missing_skills: any, n: any, n_default: any, name: any, names: any, nano: any, nano_col: any, nano_opts: any, needle: any, nm: any, nums: any, o: any, ok: any, out: any, owner: any, owner_rel: any, owners: any, pa_rows: any, padiff: any, passed: any, pat: any, path: any, prompts: any, r: any, rc: any, real: any, real_choices: any, real_flags: any, role: any, row: any, rows: any, shape_bad: any, skill: any, skill_fm: any, skills_dir: any, slot_rows: any, src: any, ssot_body: any, stale_marks: any, t: any, tag_src: any, text: any, total_slots: any, value_bad: any, w: any, want: any, want_shape: any, when: any, wrong: any;
    const fixture = mkdtempSync(join(tmpdir(), 'jstack-image-probe-'));
    const NVM_BIN = fixture;
    writeFileSync(join(fixture, process.platform === 'win32' ? 'codex.cmd' : 'codex'), process.platform === 'win32' ? '@echo off\r\necho codex fixture\r\n' : '#!/bin/sh\necho codex fixture\n', { mode: 0o755 });
    src = read(NANO);
    cli = read(CLI_MD);
    args = regexFindall("add_argument\\(\\s*\"([^\"]+)\"(?:\\s*,\\s*\"([^\"]+)\")?", src);
    declared = [];
    for ([a, b] of iterable(args)) {
        declared.push(pyOr(b, a));
        if (truth(b)) {
            declared.push(a);
        }
    }
    real = sorted(new Set(iterable(declared)));
    missing = (() => { const __items: any[] = []; for (const a of iterable(real)) {
        if (!truth((!contains(cli, a))))
            continue;
        __items.push(a);
    } return __items; })();
    check("cli.md includes every actual argument", (!truth(missing)), (truth(missing) ? ("missing " + String(missing)) : (String(length(real)) + " arguments")));
    check("cli.md: text is marked positional", (truth((contains(cli, "Positional"))) && truth((contains(cli, "Not `--prompt`")))));
    check("cli.md: --prompt is not shown as usage", (!truth(regexSearch("nanobanana\\.py\\s+--prompt", cli))));
    body = split(cli, "## Arguments", 1).at(-1)!;
    body = regexSub("Not\\s+[`*]{0,2}--[a-z-]+[`*]{0,2}", "", body, "");
    doc_opts = new Set(iterable(regexFindall("(?<![\\w-])(--[a-z][a-z-]*)(?![\\w-])", body)));
    ghost = (() => { const __items: any[] = []; for (const o of iterable(doc_opts)) {
        if (!truth((!contains(src, o))))
            continue;
        __items.push(o);
    } return __items; })();
    check("cli.md does not invent arguments absent from the implementation", (!truth(ghost)), (truth(ghost) ? ("ghost " + String(ghost)) : ""));
    m = regexSearch("MODEL\\s*=\\s*\"([^\"]+)\"", src);
    check("cli.md does not duplicate the model name", (truth(truth(m)) && truth((!contains(cli, m[1])))), (truth(m) ? m[1] : "MODEL absent"));
    flat_cli = flat(cli);
    G_NEEDLES = ["| `-g`, `--generate` | Flag | — | **Enable image generation** |", "**Omitting `-g` does not generate an image.**", "Without this flag, the script queries or analyzes an input image."];
    miss_g = (() => { const __items: any[] = []; for (const n of iterable(G_NEEDLES)) {
        if (!truth((!contains(flat_cli, n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("cli.md: the meaning of -g is not reversed", (!truth(miss_g)), ("missing " + String(miss_g)));
    g_decl = regexSearch("add_argument\\(\\s*\"-g\"\\s*,\\s*\"--generate\"\\s*,\\s*action=\"store_true\"", src);
    check("cli.md: actual -g declaration is store_true", (g_decl !== null), (truth(g_decl) ? "" : "Declaration not found"));
    gen_gate = regexSearch("if generate:\\s*\\n\\s*gen_config[^\\n]*responseModalities[^\\n]*\"IMAGE\"", src);
    check("cli.md: generation modality is enabled only under generate", (gen_gate !== null), (truth(gen_gate) ? "" : "generate branch not found"));
    ex_pairs = regexFindall("(?m)^# (Generate|Edit|Analyze)[^\\n]*\\n(python3 nanobanana\\.py[^\\n]*)", cli);
    ex_bad = (() => { const __items: any[] = []; for (const [lab, cmd] of iterable(ex_pairs)) {
        if (!truth((!equal((contains(cmd, " -g")), (contains(["Generate", "Edit"], lab))))))
            continue;
        __items.push(lab);
    } return __items; })();
    check("cli.md: example labels agree with -g presence", (truth((length(ex_pairs) >= 3)) && truth((!truth(ex_bad)))), (String(length(ex_pairs)) + " pairs; mismatches " + String(ex_bad)));
    cli_rows = parse_md_table(cli, CLIARG_HEADER);
    check("cli.md: argument headers use canonical column order", (cli_rows !== null), (truth((cli_rows !== null)) ? "" : ("Header " + String(CLIARG_HEADER) + " not found")));
    [real_flags, real_choices] = [{}, {}];
    for (decl of iterable(regexFindall("add_argument\\((.*?)\\)\\s*\\n", src))) {
        nm = regexFindall("\"(-{0,2}[a-z][a-z-]*)\"", decl);
        if (truth((!truth(nm)))) {
            continue;
        }
        key = nm.at(-1)!;
        real_flags[key] = (contains(decl, "store_true"));
        ch = regexSearch("choices=\\[([^\\]]*)\\]", decl);
        real_choices[key] = (truth(ch) ? regexFindall("\"([^\"]+)\"", ch[1]) : []);
    }
    [shape_bad, value_bad] = [[], []];
    for (r of iterable(pyOr(cli_rows, []))) {
        if (truth((!equal(length(r), length(CLIARG_HEADER))))) {
            shape_bad.push((String(r[0]) + "(" + String(length(r)) + " columns)"));
            continue;
        }
        keys = regexFindall("`(-{0,2}[a-z][a-z-]*)`", r[0]);
        key = (truth(keys) ? keys.at(-1)! : null);
        if (truth(pyOr((key === null), (!contains(real_flags, key))))) {
            shape_bad.push((String(r[0]) + "(absent from implementation)"));
            continue;
        }
        want_shape = (truth(real_flags[key]) ? "Flag" : (truth((!truth(starts(key, "-")))) ? "Positional" : "Option"));
        if (truth((!contains(r[1], want_shape)))) {
            shape_bad.push((String(key) + ": form=" + String(r[1]) + " != " + String(want_shape)));
        }
        for (c of iterable(real_choices[key])) {
            if (truth((!contains(r[2], ("`" + String(c) + "`"))))) {
                value_bad.push((String(key) + ":" + String(c)));
            }
        }
    }
    check("cli.md: form column (2) matches actual declarations", (truth(truth(cli_rows)) && truth((!truth(shape_bad)))), Array.from(shape_bad).join("; ").slice(0, 90));
    check("cli.md: value column (3) includes all actual choices", (truth(truth(cli_rows)) && truth((!truth(value_bad)))), Array.from(value_bad).join("; ").slice(0, 90));
    _skill_raw = read(join(ROOT, "SKILL.md"));
    [skill_fm, skill] = split_frontmatter(_skill_raw);
    check("Policy: explicitly prohibits installing on the user's behalf", (truth((contains(skill, "does not install"))) && truth((contains(cli, "does not install")))));
    for ([label, path, home, key, want] of iterable([["both available", [NVM_BIN, "/usr/bin", "/bin"].join(delimiter), (String("~").replace(/^~/, homedir())), "dummy", 0], ["codex only", [NVM_BIN, "/usr/bin", "/bin"].join(delimiter), "/nonexistent", null, 1], ["nanobanana only", "/usr/bin:/bin", (String("~").replace(/^~/, homedir())), "dummy", 1], ["neither available", "/usr/bin:/bin", "/nonexistent", null, 2]])) {
        [rc, out] = run_probe(path, home, key);
        check(("probe: " + String(label) + " → exit " + String(want)), (equal(rc, want)), ("exit=" + String(rc)));
    }
    const both_out = run_probe([NVM_BIN, "/usr/bin", "/bin"].join(delimiter), homedir(), "dummy")[1];
    const nano_only_out = run_probe("/usr/bin:/bin", homedir(), "dummy")[1];
    check("probe: every nanobanana recommendation says each run needs approval", contains(both_out, "propose nanobanana; each run needs approval") && contains(nano_only_out, "nanobanana 만 가능 — propose it; each run needs approval"));
    [_, out] = run_probe("/usr/bin:/bin", "/nonexistent");
    check("probe: no-key guidance describes availability for key holders", (contains(out, "optional for Google API key holders")));
    // The probe must find a key where the script does: ./.env before the home file, and only non-empty values.
    const fake_home = join(fixture, "home"), home_key = join(fake_home, ".claude", ".env.nanobanana");
    mkdirSync(dirname(home_key), { recursive: true });
    writeFileSync(home_key, "GEMINI_API_KEY=dummy\n");
    const key_cases: [string, string, string | null][] = [["GEMINI_API_KEY=dummy\n", "/nonexistent", ".env"], ["GEMINI_API_KEY=dummy\n", fake_home, ".env"], ["GEMINI_API_KEY=\"\"\n", fake_home, home_key], ["export GEMINI_API_KEY=dummy\n", "/nonexistent", ".env"], ["GEMINI_API_KEY= # note\n", "/nonexistent", null]];
    const key_bad = key_cases.flatMap(([content, home, want], i) => {
        const dir = realpathSync(mkdtempSync(join(fixture, 'env-')));
        writeFileSync(join(dir, ".env"), content);
        const [rc, probe_out] = run_probe("/usr/bin:/bin", home, null, dir);
        const ok = want === null ? equal(rc, 2) : equal(rc, 1) && contains(probe_out, "key source: " + (want === ".env" ? join(dir, ".env") : want));
        return ok ? [] : ["case " + String(i + 1) + " exit=" + String(rc)];
    });
    check("probe: key sources follow the script's order and skip empty values", !truth(key_bad), Array.from(key_bad).join("; "));
    // Every file:line citation of nanobanana.py must point at the code it describes.
    const src_lines = src.split(/\r?\n/);
    const cited = (doc: string, needle: string) => { const c = regexSearch("nanobanana\\.py:(\\d+)(?:-(\\d+))?", doc.slice(doc.indexOf(needle))); return c ? src_lines.slice(Number(c[1]) - 1, Number(c[2] ?? c[1])).join("\n") : ""; };
    check("nanobanana.py citations point at the code they describe", contains(cited(skill, "The script uses the first key it finds"), "def resolve_api_key") && contains(cited(cli, "**The script exits immediately if absent**"), "sys.exit(\"Error: GEMINI_API_KEY") && contains(cited(cli, "The `MODEL` constant in"), "MODEL = "));
    // Run the real script with stand-ins for requests, python-dotenv, and Pillow, so CI needs none of them.
    const harness = join(fixture, "nanobanana_harness.py");
    writeFileSync(harness, `import importlib.util, json, os, sys, types
from pathlib import Path
calls = []
requests = types.ModuleType("requests"); requests.post = lambda *a, **k: calls.append(1)
dotenv = types.ModuleType("dotenv")
dotenv.dotenv_values = lambda path: {k.strip(): v.strip().strip("\\"'") for k, _, v in (line.partition("=") for line in Path(path).read_text().splitlines())}
pil = types.ModuleType("PIL"); pil.Image = types.ModuleType("PIL.Image")
sys.modules.update({"requests": requests, "dotenv": dotenv, "PIL": pil, "PIL.Image": pil.Image})
root = Path(sys.argv[2]); home, work = root / "home", root / "work"
(home / ".claude").mkdir(parents=True); work.mkdir()
os.environ["HOME"] = str(home); os.environ.pop("GEMINI_API_KEY", None); os.chdir(work)
spec = importlib.util.spec_from_file_location("nanobanana", sys.argv[1]); nb = importlib.util.module_from_spec(spec); spec.loader.exec_module(nb)
result = {}
(home / ".claude" / ".env.nanobanana").write_text("GEMINI_API_KEY=home\\n"); (work / ".env").write_text("GEMINI_API_KEY=cwd\\n")
result["cwd"] = nb.resolve_api_key()
(work / ".env").write_text("GEMINI_API_KEY=\\n"); result["empty"] = nb.resolve_api_key()
os.environ["GEMINI_API_KEY"] = "shell"; result["shell"] = nb.resolve_api_key()
def exit_code(argv):
    sys.argv = ["nanobanana.py", *argv]
    try:
        nb.main()
    except SystemExit as error:
        return error.code
    except Exception as error:
        return type(error).__name__
result["bad_extension"] = exit_code(["x", "-g", "-o", "out.txt"])
result["missing_directory"] = exit_code(["x", "-g", "-o", "missing/x.png"])
result["requests"] = len(calls)
print(json.dumps(result))
`);
    const py = spawnSync("python3", ["-I", harness, NANO, mkdtempSync(join(fixture, "py-"))], { encoding: "utf8" });
    let py_result: any = {};
    try { py_result = JSON.parse(py.stdout.trim().split(/\r?\n/).at(-1) ?? ""); } catch { }
    check("nanobanana.py: key order is the shell, then ./.env, then the home file", equal(py_result.cwd, "cwd") && equal(py_result.empty, "home") && equal(py_result.shell, "shell"), (py.stderr || JSON.stringify(py_result)).slice(0, 120));
    check("nanobanana.py: a bad output name is rejected before any request", equal(py_result.bad_extension, 2) && equal(py_result.missing_directory, 2) && equal(py_result.requests, 0), JSON.stringify(py_result).slice(0, 120));
    check("nanobanana.py: output is re-encoded to the format its extension names", contains(src, "fmt = OUTPUT_FORMATS[out_path.suffix.lower()]") && contains(src, "img.save(out_path, format=fmt)"));
    for ([label, needle] of iterable([["Key issuance URL", "aistudio.google.com/apikey"], ["Configuration path", ".env.nanobanana"], ["Environment-variable alternative", "export GEMINI_API_KEY"], ["Dependency installation", "requirements.txt"], ["Local .env override warning", ".env overrides home settings"], ["Commit prohibition", "Never commit keys"]])) {
        check(("probe guidance: " + String(label)), (contains(out, needle)));
    }
    for ([label, needle] of iterable([["Key issuer", "aistudio.google.com/apikey"], ["Restricted permissions", "chmod 600"], ["No key sharing", "Do not share another person's key"], ["Replace exposed keys", "revoke and replace it immediately"], ["Local .env precedence warning", "overrides the home configuration"], ["Load-order evidence (file:line)", "(`scripts/nanobanana.py:"]])) {
        check(("SKILL.md setup: " + String(label)), (contains(skill, needle)));
    }
    KEY_NEEDLES = ["3. Never place keys in the repository.", "Ignore `.env` files.", "If a key was committed, removing it from history is insufficient", "revoke and replace it immediately", "Do not share another person's key"];
    miss_key = (() => { const __items: any[] = []; for (const n of iterable(KEY_NEEDLES)) {
        if (!truth((!contains(flat(skill), n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("SKILL.md: key-commit prohibition is not reversed", (!truth(miss_key)), ("missing " + String(miss_key)));
    check("SKILL.md: body explains the default-path choice", (contains(skill, "Codex is the default because")));
    function parse_role_table(text: any): any {
        let body_line: any, c: any, cells: any, head: any, i: any, ix: any, k: any, line: any, lines: any, name: any, out: any;
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
            if (truth((!truth(Array.from(new Set(["Role", "Requirements", "When"])).every((v: any) => contains(new Set(iterable(head)), v)))))) {
                continue;
            }
            if (truth(pyOr(((i + 1) >= length(lines)), (!truth(regexMatch("^\\s*\\|[\\s:|-]+\\|\\s*$", lines[(i + 1)])))))) {
                continue;
            }
            ix = Object.fromEntries(iterable(["Role", "Requirements", "When"]).map((k: any) => [k, head.indexOf(k)]));
            for (body_line of iterable(lines.slice((i + 2)))) {
                if (truth((!truth(starts(body_line.trimStart(), "|"))))) {
                    break;
                }
                c = cells(body_line);
                name = (truth(c) ? regexSub("[*`]", "", c[0], "").trim() : "");
                if (truth((!truth(name)))) {
                    continue;
                }
                if (truth((!equal(length(c), length(head))))) {
                    malformed.push((String(name) + "(" + String(length(c)) + " columns/" + String(length(head)) + ")"));
                    continue;
                }
                out[name] = { "role": stripChars(c[ix["Role"]], "`"), "needs": c[ix["Requirements"]], "when": c[ix["When"]] };
            }
        }
        return out;
    }
    malformed = [];
    rows = parse_role_table(skill);
    check("SKILL.md: path table has no malformed rows", (!truth(malformed)), Array.from(malformed).join("; ").slice(0, 80));
    codex = (rows["codex"] ?? { "role": "", "needs": "", "when": "" });
    nano = (rows["nanobanana"] ?? { "role": "", "needs": "", "when": "" });
    const openai = (rows["openai"] ?? { "role": "", "needs": "", "when": "" });
    check("SKILL.md: path table includes codex and nanobanana", (truth((contains(rows, "codex"))) && truth((contains(rows, "nanobanana")))), ("rows " + String(sorted(rows))));
    check("SKILL.md: path table includes openai", contains(rows, "openai"), ("rows " + String(sorted(rows))));
    check("SKILL.md: openai role is `선택`", equal(openai["role"], "선택"), openai["role"]);
    check("SKILL.md: openai path requires OPENAI_API_KEY and states billing", contains(openai["needs"], "OPENAI_API_KEY") && contains(openai["needs"], "billed"), openai["needs"].slice(0, 60));
    check("SKILL.md: openai path is conditioned on user approval", contains(openai["when"], "The user approves the charge for a run that needs a control the codex path lacks"), openai["when"].slice(0, 60));
    check("SKILL.md: nanobanana path states billing", contains(nano["needs"], "billed"), nano["needs"].slice(0, 60));
    check("SKILL.md: nanobanana path is conditioned on user approval", contains(nano["when"], "The user approves the charge for a run that needs direct control"), nano["when"].slice(0, 60));
    check("SKILL.md: codex role is `기본`", (equal(codex["role"], "기본")), codex["role"]);
    check("SKILL.md: nanobanana role is `선택`", (equal(nano["role"], "선택")), nano["role"]);
    check("SKILL.md: roles differ (both cannot be default)", (!equal(codex["role"], nano["role"])));
    n_default = (() => { const __items: any[] = []; for (const r of iterable(Object.values(rows))) {
        if (!truth((equal(r["role"], "기본"))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    check("SKILL.md: exactly one `기본` role across the full table", (equal(n_default, 1)), (String(n_default) + " defaults / rows " + String(sorted(rows))));
    check("SKILL.md: body states exactly one default", (contains(skill, "exactly one row")));
    check("SKILL.md: body defines role and timing columns", (contains(skill, "The role and timing columns are declarations with fixed pairings")));
    PAIR = { "기본": (w: any) => starts(stripChars(w, "`"), "상시"), "선택": (w: any) => starts(stripChars(w, "`"), "조건:") };
    for ([name, row] of iterable([["codex", codex], ["nanobanana", nano], ["openai", openai]])) {
        [role, when] = [row["role"], row["when"]];
        ok = (truth((contains(PAIR, role))) && truth(PAIR[role](when)));
        check(("SKILL.md: " + String(name) + " role/timing pair agrees"), ok, ("role=" + String(role) + " when=" + String(when.slice(0, 30))));
    }
    check("SKILL.md: body declares mismatched pairs a contract violation", (contains(skill, "Mismatched pairs violate the contract")));
    check("SKILL.md: default path requires no preparation", (contains(codex["needs"], "None")), codex["needs"].slice(0, 40));
    check("SKILL.md: optional path requires a key", pyOr((contains(nano["needs"], "GEMINI_API_KEY")), (contains(nano["needs"], "API key"))), nano["needs"].slice(0, 40));
    check("SKILL.md: paths have different prerequisites", (!equal(codex["needs"], nano["needs"])));
    check("SKILL.md: body explains why codex is default", (contains(skill, "because it needs no additional preparation")));
    // Each image on a paid path is billed, so the approval gate and its scope must stay intact.
    const APPROVAL_NEEDLES = ["The nanobanana and openai paths are never chosen automatically", "a ChatGPT or Codex subscription does not cover it", "Propose it only for a requirement the codex path cannot meet", "Before each run on either path, ask the user to approve it", "Path, model, quality, size, and image count.", "looked up for this run, not from memory", "Approval is the user's answer to that statement.", "A request that names a paid path, a model, or a tier is not approval", "A run is one command with the stated prompt, settings, and count, and approval covers only that run.", "needs a new approval", "Without approval, stay on the codex path", "A codex failure is a reason to propose a paid path, not approval to use it.", "Only nanobanana: propose it and wait for approval; without approval, stop.", "propose it before openai"];
    const miss_approval = APPROVAL_NEEDLES.filter(n => !contains(flat(skill), n));
    const path_gates = flat(skill).split("Each run needs the user's approval under \"Approval for paid paths\".").length - 1;
    check("SKILL.md: paid-path approval gate is not removed or widened", !truth(miss_approval) && path_gates === 2, ("missing " + String(miss_approval) + "; per-path gates " + String(path_gates)));
    // The price snapshot is checked against the model the script calls, so a model change cannot leave a stale row.
    const snapshot = split(split(skill, "### Price snapshot", 1).at(-1)!, "\n## ", 1)[0];
    const nano_model = regexSearch("MODEL\\s*=\\s*\"([^\"]+)\"", src);
    check("SKILL.md: price snapshot names the model nanobanana.py calls", contains(skill, "### Price snapshot") && truth(nano_model) && contains(snapshot, "| nanobanana | `" + nano_model![1] + "` |"), (truth(nano_model) ? nano_model![1] : "MODEL absent"));
    check("SKILL.md: price snapshot is dated and links both pricing pages", truth(regexSearch("### Price snapshot \\(checked \\d{4}-\\d{2}-\\d{2}\\)", skill)) && contains(snapshot, "https://ai.google.dev/gemini-api/docs/pricing") && contains(snapshot, "https://developers.openai.com/api/docs/pricing"));
    check("SKILL.md: price snapshot defers to the live pricing page", contains(flat(snapshot), "Quote the live pricing page in the approval request"));
    check("SKILL.md: openai command names the model explicitly", truth(regexSearch("openai images generate --model <model>", skill)) && contains(skill, "Pass `--model` explicitly"));
    check("SKILL.md: probe results never select the openai path", contains(flat(skill), "Never select the openai path from probe results"));
    check("SKILL.md: discloses that codex cannot pass quality tiers", contains(flat(skill), "takes no quality or size argument"));
    check("SKILL.md: openai key is never printed or created", contains(flat(skill), "Never print the key, pass it as an argument, or create a key."));
    skills_dir = dirname(ROOT);
    NAME = "(?<![\\w-])[`*]{0,2}([a-z][a-z-]{2,})[`*]{0,2}\\s*skill\\b";
    MARKED = (NAME + "\\s*\\(미구현");
    EXCUSED = (NAME + "\\s*\\(미구현\\s*[—–-]\\s*[^)]{4,}\\)");
    function classify_mentions(text: any): any {
        let absent: any, excused: any, live: any, marked: any, n: any, named: any, stale: any;
        named = sorted(new Set(iterable(regexFindall(NAME, text))));
        marked = new Set(iterable(regexFindall(MARKED, text)));
        excused = new Set(iterable(regexFindall(EXCUSED, text)));
        live = new Set((() => { const __items: any[] = []; for (const n of iterable(named)) {
            if (!truth(isDir(join(skills_dir, n))))
                continue;
            __items.push(n);
        } return __items; })());
        stale = sorted(intersection(marked, live));
        absent = sorted((() => { const __items: any[] = []; for (const n of iterable(named)) {
            if (!truth((truth((!contains(live, n))) && truth((!contains(excused, n))))))
                continue;
            __items.push(n);
        } return __items; })());
        return [named, stale, absent];
    }
    [declared, stale_marks, missing_skills] = classify_mentions(skill);
    check("Handoff destination population is nonempty", (length(declared) >= 1), String(declared));
    check("All handoff destinations exist", (!truth(missing_skills)), (truth(missing_skills) ? ("missing " + String(missing_skills)) : (String(declared))));
    check("No existing skill carries a stale `(미구현)` marker", (!truth(stale_marks)), (truth(stale_marks) ? ("Existing skills " + String(stale_marks)) : ""));
    check("Body mentions other skills (ownership boundaries exist)", truth(declared), String(declared));
    check("SKILL.md: `(미구현)` does not waive existence checks", (contains(flat(skill), "`(미구현)` does not waive existence checks")));
    _fake = "The `zzz-nosuch` skill(미구현) owns this task.";
    _stale = "The `diagram` skill(미구현) owns diagrams.";
    _excused = "The `zzz-nosuch` skill(미구현 — plan C-99, not implemented yet) owns this task.";
    check("Detector: unexplained `(미구현)` does not excuse absence", (contains(classify_mentions(_fake)[2], "zzz-nosuch")), String(classify_mentions(_fake)[2]));
    check("Detector: `(미구현)` on an existing skill is stale", (contains(classify_mentions(_stale)[1], "diagram")), String(classify_mentions(_stale)[1]));
    check("Detector: explained `(미구현 — …)` excuses absence", (!contains(classify_mentions(_excused)[2], "zzz-nosuch")), String(classify_mentions(_excused)[2]));
    bound_rows = parse_md_table(skill, BOUNDARY_HEADER);
    check("SKILL.md: ownership headers use canonical column order", (bound_rows !== null), (truth((bound_rows !== null)) ? "" : ("Header " + String(BOUNDARY_HEADER) + " not found")));
    bdiff = row_diff(bound_rows, BOUNDARY_ROWS);
    check("SKILL.md: ownership row/owner mapping matches the canon", (!truth(bdiff)), Array.from(bdiff).join("; ").slice(0, 90));
    owners = (() => { const __items: any[] = []; for (const r of iterable(pyOr(bound_rows, []))) {
        if (!truth((length(r) > 1)))
            continue;
        __items.push(stripChars(r[1], "`*"));
    } return __items; })();
    ghost_owners = (() => { const __items: any[] = []; for (const o of iterable(owners)) {
        if (!truth((!truth(isDir(join(skills_dir, o))))))
            continue;
        __items.push(o);
    } return __items; })();
    check("SKILL.md: every skill in the owner column exists", (truth(truth(owners)) && truth((!truth(ghost_owners)))), (truth(ghost_owners) ? ("missing " + String(ghost_owners)) : (String(owners))));
    check("SKILL.md: discloses codex dimensional-control limits", (truth((contains(skill, "aspect ratio"))) && truth((contains(skill, "reducing control")))));
    prompts = read(PROMPTS_MD);
    flat_prompts = flat(prompts);
    slot_rows = parse_md_table(prompts, SLOT_HEADER);
    check("prompts: slot headers use canonical column order", (slot_rows !== null), (truth((slot_rows !== null)) ? "" : ("Header " + String(SLOT_HEADER) + " not found")));
    rows = pyOr(slot_rows, []);
    nums = (() => { const __items: any[] = []; for (const r of iterable(rows)) {
        if (!truth((truth(r) && truth(/^\d+$/.test(r[0])))))
            continue;
        __items.push(Number(r[0]));
    } return __items; })();
    names = (() => { const __items: any[] = []; for (const r of iterable(rows)) {
        if (!truth((length(r) > 1)))
            continue;
        __items.push(r[1]);
    } return __items; })();
    check("prompts: slot table is readable", (length(rows) >= 1), (String(length(rows)) + " rows"));
    check("prompts: 12 slot rows (11 plus one Hero-only slot)", (equal(length(rows), length(CANON_ROWS))), (String(length(rows)) + " rows"));
    check("prompts: numbering is contiguous from 1 through 12", (equal(nums, Array.from(range(1, (length(CANON_ROWS) + 1))))), String(nums));
    check("prompts: slot names and order match the canon", (equal(names, (() => { const __items: any[] = []; for (const r of iterable(CANON_ROWS)) {
        __items.push(r[1]);
    } return __items; })())), ("differences " + String((() => { const __items: any[] = []; for (const [a, b] of iterable(zip(names, CANON_ROWS))) {
        if (!truth((!equal(a, b[1]))))
            continue;
        __items.push(a);
    } return __items; })())));
    c3 = (() => { const __items: any[] = []; for (const r of iterable(rows)) {
        if (!truth((length(r) > 2)))
            continue;
        __items.push([r[0], r[2]]);
    } return __items; })();
    c4 = (() => { const __items: any[] = []; for (const r of iterable(rows)) {
        if (!truth((length(r) > 3)))
            continue;
        __items.push([r[0], r[3]]);
    } return __items; })();
    bad3 = pyOr((() => { const __items: any[] = []; for (const [[a, g], w] of iterable(zip(c3, CANON_ROWS))) {
        if (!truth((!equal(g, w[2]))))
            continue;
        __items.push(("r" + String(a)));
    } return __items; })(), (truth((equal(length(c3), length(CANON_ROWS)))) ? [] : [("row count " + String(length(c3)))]));
    bad4 = pyOr((() => { const __items: any[] = []; for (const [[a, g], w] of iterable(zip(c4, CANON_ROWS))) {
        if (!truth((!equal(g, w[3]))))
            continue;
        __items.push(("r" + String(a)));
    } return __items; })(), (truth((equal(length(c4), length(CANON_ROWS)))) ? [] : [("row count " + String(length(c4)))]));
    check("prompts: column 3 (what to specify) matches every canonical row", (!truth(bad3)), Array.from(bad3).join(" ").slice(0, 80));
    check("prompts: column 4 (omission outcome) matches every canonical row", (!truth(bad4)), Array.from(bad4).join(" ").slice(0, 80));
    hero_rows = (() => { const __items: any[] = []; for (const r of iterable(rows)) {
        if (!truth((truth((length(r) > 2)) && truth((contains(r[2], "Hero only"))))))
            continue;
        __items.push(r);
    } return __items; })();
    total_slots = length(rows);
    base_slots = subtract(total_slots, length(hero_rows));
    check("prompts: exactly one Hero-only row, with the final number", (truth((equal(length(hero_rows), 1))) && truth((equal(hero_rows[0][0], String(total_slots))))), (String(length(hero_rows)) + " rows " + String((() => { const __items: any[] = []; for (const r of iterable(hero_rows)) {
        __items.push(r[0]);
    } return __items; })())));
    check("prompts: measured slots are 11 base and 12 Hero", (equal([base_slots, total_slots], [11, 12])), (String(base_slots) + "/" + String(total_slots)));
    SLOT_CLAIMS = [["prompts H1", flat_prompts, "# Image prompt slots: (\\d+) slots \\((\\d+) for Hero only\\)", [base_slots, total_slots]], ["prompts confirmed count", flat_prompts, "\\*\\*There are (\\d+) slots\\.\\*\\*", [base_slots]], ["prompts Hero addition", flat_prompts, "adds `Color palette`, making (\\d+)", [total_slots]], ["prompts Hero-only clause", flat_prompts, "\\*\\*Only Hero has (\\d+) slots\\.\\*\\* The other six asset kinds use (\\d+)", [total_slots, base_slots]], ["prompts join-table left column", flat_prompts, "A slot among (\\d+)-(\\d+) \\((\\d+)\\) was empty", [1, base_slots, total_slots]], ["prompts checklist", flat_prompts, "Have \\*\\*all (\\d+) slots \\((\\d+) for Hero\\)\\*\\* been written", [base_slots, total_slots]], ["SKILL.md Phase 1", flat(skill), "Use (\\d+) prompt slots \\((\\d+) for Hero assets\\)", [base_slots, total_slots]]];
    [found, wrong] = [[], []];
    for ([label, text, pat, want] of iterable(SLOT_CLAIMS)) {
        m2 = regexSearch(pat, text);
        if (truth((m2 === null))) {
            continue;
        }
        found.push(label);
        if (truth((!equal(Array.from((() => { const __items: any[] = []; for (const g of iterable(m2.slice(1))) {
            __items.push(Number(g));
        } return __items; })()), want)))) {
            wrong.push((String(label) + "=" + String(m2.slice(1))));
        }
    }
    check("prompts/SKILL: all seven slot-count declarations found", (equal(length(found), length(SLOT_CLAIMS))), ("Found " + String(found)));
    check("prompts/SKILL: every slot-count declaration matches measured 11/12", (!truth(wrong)), Array.from(wrong).join("; ").slice(0, 100));
    check("prompts: non-Hero assets explicitly omit Color palette", (contains(flat_prompts, "omit `Color palette`")));
    ORDER_NEEDLES = ["## Slot table: order is a contract", "Move from broad to specific.", "Reordering can make the model read later slots as modifiers of earlier slots, confusing the scene and subject."];
    miss_order = (() => { const __items: any[] = []; for (const n of iterable(ORDER_NEEDLES)) {
        if (!truth((!contains(flat_prompts, n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("prompts: slot-order contract direction is not reversed", (!truth(miss_order)), ("missing " + String(miss_order)));
    LEN_NEEDLES = ["**Use large labels only.** Paragraph-length Korean text loses stroke fidelity.", "Measurements found accurate short words but degradation as character count increased", "**Embedded lettering cannot be edited afterward.**"];
    miss_len = (() => { const __items: any[] = []; for (const n of iterable(LEN_NEEDLES)) {
        if (!truth((!contains(flat_prompts, n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("prompts: Korean label-length constraint is not reversed", (!truth(miss_len)), ("missing " + String(miss_len)));
    SKILL_LEN_NEEDLES = ["with correct glyph shapes", "Longer text can still break; visually inspect results."];
    miss_slen = (() => { const __items: any[] = []; for (const n of iterable(SKILL_LEN_NEEDLES)) {
        if (!truth((!contains(flat(skill), n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("SKILL.md: Korean measurement findings are not reversed", (!truth(miss_slen)), ("missing " + String(miss_slen)));
    join_rows = parse_md_table(prompts, JOIN_HEADER);
    check("prompts: join headers use canonical column order", (join_rows !== null), (truth((join_rows !== null)) ? "" : ("Header " + String(JOIN_HEADER) + " not found")));
    jdiff = row_diff(join_rows, JOIN_ROWS);
    check("prompts: join row/column mapping matches the canon", (!truth(jdiff)), Array.from(jdiff).join("; ").slice(0, 90));
    m_ssot = regexSearch("The canonical tag-value set is the \\\"Cause tags\\\" definition table in the `([a-z][a-z-]*)` skill's `([^`]+)`", flat_prompts);
    check("prompts: canonical tag owner is parseable from the sentence", (m_ssot !== null), (truth(m_ssot) ? "" : "Canonical declaration sentence not found"));
    owner = (truth(m_ssot) ? m_ssot[1] : "");
    owner_rel = (truth(m_ssot) ? m_ssot[2] : "");
    check("prompts: canonical source points to deck design-slop.md", (equal([owner, owner_rel], ["deck", "references/design-slop.md"])), (String(owner) + " / " + String(owner_rel)));
    tag_src = (truth(owner) ? join(skills_dir_of(ROOT), owner, owner_rel) : "");
    ssot_body = (truth((truth(tag_src) && truth(isFile(tag_src)))) ? read(tag_src) : "");
    check("prompts: referenced canonical file actually defines tag values", (truth((contains(ssot_body, "## Cause tags"))) && truth(((() => { const __items: any[] = []; for (const t of iterable(TAG_LITERALS)) {
        if (!truth((contains(ssot_body, t))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0) >= 2))), pyOr(tag_src, "Path absent"));
    dup = (() => { const __items: any[] = []; for (const t of iterable(TAG_LITERALS)) {
        if (!truth((contains(prompts, t))))
            continue;
        __items.push(t);
    } return __items; })();
    check("prompts: cause-tag values are not duplicated (deck owns them)", (!truth(dup)), ("duplicates " + String(dup)));
    check("prompts: document declares itself noncanonical", (truth((contains(flat_prompts, "Do not duplicate those values here"))) && truth((contains(flat_prompts, "That value set is awaiting a decision")))));
    pa_rows = parse_md_table(prompts, PATHARG_HEADER);
    check("prompts: path-argument headers use canonical column order", (pa_rows !== null), (truth((pa_rows !== null)) ? "" : ("Header " + String(PATHARG_HEADER) + " not found")));
    padiff = row_diff(pa_rows, PATHARG_ROWS);
    check("prompts: path-argument row/column mapping matches the canon", (!truth(padiff)), Array.from(padiff).join("; ").slice(0, 90));
    codex_col = Array.from((() => { const __items: any[] = []; for (const r of iterable(pyOr(pa_rows, []))) {
        if (!truth((length(r) > 1)))
            continue;
        __items.push(r[1]);
    } return __items; })()).join(" ");
    nano_col = Array.from((() => { const __items: any[] = []; for (const r of iterable(pyOr(pa_rows, []))) {
        if (!truth((length(r) > 2)))
            continue;
        __items.push(r[2]);
    } return __items; })()).join(" ");
    check("prompts: codex column contains no unsupported argument tokens", (truth(truth(pa_rows)) && truth((!truth(regexSearch("(?<![\\w-])--[a-z]", codex_col))))), codex_col.slice(0, 60));
    nano_opts = new Set(iterable(regexFindall("(?<![\\w-])(--[a-z][a-z-]*)(?![\\w-])", nano_col)));
    check("prompts: nanobanana column arguments exist in the implementation", (truth(truth(nano_opts)) && truth((() => { const __items: any[] = []; for (const o of iterable(nano_opts)) {
        __items.push((contains(src, o)));
    } return __items; })().every(truth))), (String(sorted(nano_opts))));
    check_ref_contracts(check, ROOT, [["cli.md", "Argument table matches implementation", ["--aspect", "--size", "--image", "GEMINI_API_KEY"], 1497], ["prompts.md", "Slot structure and tag join remain substantive", ["Text (verbatim, large labels only)", "Empty slots are filled with defaults", "The canonical tag-value set is", "Only Hero has 12 slots"], 5423]]);
    check_skill_body(check, ROOT, { needles: ["Text embedded in a raster image cannot be edited later", "The role and timing columns are declarations with fixed pairings", "Without a key, this path\nis unavailable", "Mismatched pairs violate the contract", "Use 11 prompt slots (12 for Hero assets)"], floor: 4243 });
    check_no_constant_assertions(check, __file__);
    live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) {
        if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    for (const [file, needles] of [["NOTICE", ["vibedesignlab/slopslap"]], ["LICENSE.slopslap", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
    check_contract_coverage(check, __file__, ROOT, { per_file: {"NOTICE": 1, "LICENSE.slopslap": 1,  "SKILL.md": 56, "references/cli.md": 12, "references/prompts.md": 27 }, live_ran: live_ran });
    check_body_deletion(check, __file__, ROOT, { minimum: 91, extra_strip: ["references/cli.md", "references/prompts.md"], live_ran: live_ran });
    check_script_contracts(check, __file__, ROOT, { scripts: { "scripts/nanobanana.py": 11, "scripts/probe_backends.js": 12 }, live_ran: live_ran });
    check_total(check, results, 134);
    passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) {
        if (!truth(ok))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    console.log(("\n" + String(passed) + "/" + String(length(results)) + " 통과"));
    rmSync(fixture, { recursive: true, force: true });
    return (truth((equal(passed, length(results)))) ? 0 : 1);
}
if (isMain(import.meta.url))
    process.exitCode = main();
