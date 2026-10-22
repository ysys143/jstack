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
function union(a: any, b: any): Set<any> { return new Set([...iterable(a), ...iterable(b)]); }
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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { specialistStatus } from '../../../../../runtime/specialists.js';
const environment = specialistStatus('deck', { home: process.env.JSTACK_SPECIALIST_HOME, root: dirname(SKILLS) });
if (environment.state !== 'ready')
    throw new Error('Set up the manifest-locked deck optional environment before running specialist contracts');
const python = environment.python;
function read(path: string): string { return readFileSync(path, 'utf8'); }
function stripChars(text: string, chars: string): string { let a = 0, b = text.length; while (a < b && chars.includes(text[a]))
    a++; while (b > a && chars.includes(text[b - 1]))
    b--; return text.slice(a, b); }
function partition(text: string, sep: string): [
    string,
    string,
    string
] { const i = text.indexOf(sep); return i < 0 ? [text, '', ''] : [text.slice(0, i), sep, text.slice(i + sep.length)]; }
function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const REFS = join(ROOT, "references");
const SCRIPTS = join(ROOT, "scripts");
const ENSURE = join(SCRIPTS, "ensure_marp.js");
const ASSEMBLE = join(SCRIPTS, "assemble.py");
const PDF2PPTX = join(SCRIPTS, "pdf2pptx.py");
const REQS = join(ROOT, "requirements.txt");
const STYLE_FONTS = join(HERE, "test_style_fonts.js");
const SLOP_AXES = join(HERE, "test_slop_axes.js");
function run_py(argv: string[], opts: {
    env?: NodeJS.ProcessEnv;
} = {}): [
    number | null,
    string
] { const r = spawnSync(argv[0].endsWith('.js') ? process.execPath : python, argv, { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...opts.env } }); return [r.status, (r.stdout ?? '') + (r.stderr ?? '')]; }
function run_ensure(script: string, opts: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
} = {}): [
    number | null,
    string
] { const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: homedir(), ...opts.env }, cwd: opts.cwd }); return [r.status, r.stdout ?? '']; }
function main(): any {
    let _: any, _k: any, _skill_raw: any, absent: any, ans: any, blk: any, block3: any, block_dir: any, body: any, crit: any, crit_tags: any, declared: any, dest: any, det_j: any, detail: any, dummy_pdf: any, ensure_decl: any, ev: any, f: any, fn_: any, have_pptx: any, heads: any, helps: any, hi: any, i: any, items: any, k: any, korean: any, label: any, listed: any, live_ran: any, ln: any, lo: any, m: any, m2: any, m_dep: any, m_in: any, mark: any, marp_md: any, md: any, md3: any, missing: any, n: any, nb: any, needed: any, needle: any, needles: any, notice: any, ok: any, ok_j: any, orphan: any, other: any, out: any, out_html: any, out_pptx: any, own_skill: any, passed: any, path_: any, pkgs: any, plan_keys: any, plan_out: any, plan_path: any, plan_src: any, r: any, rc: any, rc_a1: any, rc_dep: any, rc_full: any, rc_h: any, rc_html: any, rc_j: any, rc_none: any, rc_opt: any, rc_p1: any, real: any, ref_table: any, refs_head: any, refs_sep: any, refs_tail: any, reqs: any, role_rows: any, routing: any, rows: any, runnable: any, schema_doc: any, skill: any, skill_fm: any, slop: any, src: any, src_asm: any, src_pdf: any, stack: any, styles: any, t: any, tags: any, tmp: any, tmp2: any, tmp3: any, txt: any, txt_dep: any, txt_h: any, txt_j: any, txt_opt: any, uncalled: any, undoc: any, unknown: any, unlisted: any, v: any, val: any;
    marp_md = read(join(REFS, "marp.md"));
    for ([label, needles] of iterable([["1 hard browser dependency", ["for PDF, PPTX, and image", "HTML works without a browser"]], ["2 non-editable PPTX", ["[EXPERIMENTAL]", "embeds each slide as an image"]], ["3 allow-local-files", ["(NOT SECURE)", "Do not enable it for Markdown of unknown origin"]], ["4 missing CJK stack", ["covers\nLatin", "browser-selected fonts"]]])) {
        missing = (() => { const __items: any[] = []; for (const n of iterable(needles)) {
            if (!truth((!contains(marp_md, n))))
                continue;
            __items.push(n);
        } return __items; })();
        check(("marp contract " + String(label)), (!truth(missing)), (truth(missing) ? ("missing " + String(missing)) : ""));
    }
    check("marp contract: original help excerpts are present", (truth((contains(marp_md, "--pptx-editable"))) && truth((contains(marp_md, "--browser")))));
    function cjk_stack(text: any): any {
        let blocks: any, f: any, m: any;
        blocks = regexFindall("(?ms)^```css\\s*\\n(.*?)^```", text);
        m = regexSearch("section\\s*\\{[^}]*?font-family:\\s*([^;}]+)", Array.from(blocks).join("\n"));
        if (truth((!truth(m)))) {
            return [];
        }
        return (() => { const __items: any[] = []; for (const f of iterable(split(m[1], ","))) {
            __items.push(stripChars(f.trim(), "\"'"));
        } return __items; })();
    }
    stack = cjk_stack(marp_md);
    korean = (() => { const __items: any[] = []; for (const f of iterable(stack)) {
        if (!truth(regexSearch("Pretendard|Noto Sans KR|Apple SD Gothic|Malgun|Nanum", f, "i")))
            continue;
        __items.push(f);
    } return __items; })();
    check("marp contract: CJK fonts occur inside the stack declaration", (length(korean) >= 2), (String(korean)));
    check("marp contract: the stack ends with sans-serif fallback", (truth(truth(stack)) && truth((contains(stack.at(-1)!, "sans-serif")))));
    _skill_raw = read(join(ROOT, "SKILL.md"));
    [skill_fm, skill] = split_frontmatter(_skill_raw);
    rows = regexFindall("(?m)^\\|\\s*\\*\\*(Yes|No)\\*\\*[^|]*\\|([^|]*)\\|", skill);
    routing = Object.fromEntries(iterable(rows).map(([ans, dest]: any) => [ans, dest]));
    check("Backend routing: No routes to marp", (contains((routing["No"] ?? ""), "marp")), String((routing["No"] ?? "no row")).slice(0, 60));
    check("Backend routing: Yes returns to office", (contains((routing["Yes"] ?? ""), "office")), String((routing["Yes"] ?? "no row")).slice(0, 60));
    check("Backend routing: marp is the default", (regexSearch("marp.*default|default.*marp", skill) !== null));
    check("Backend routing: ask the user when ambiguous", (contains(skill, "Ask when it is ambiguous")));
    check("ensure_marp.js exists", existsSync(ENSURE));
    // Model availability explicitly; the contributor's installed tools are not fixtures.
    tmp = mkdtempSync(join(tmpdir(), "jstack-deck-"));
    nb = join(tmp, "ensure_nb.mjs");
    src = read(ENSURE).replaceAll("/Applications", "/NO_SUCH_APPS");
    src = src.replaceAll("'../../../runtime/", "'" + new URL('../../../../../runtime/', import.meta.url).href).replaceAll('"../../../runtime/', '"' + new URL('../../../../../runtime/', import.meta.url).href);
    writeFileSync(nb, src);
    const tools = join(tmp, 'bin'); mkdirSync(tools);
    const marp = join(tools, 'marp'), browser = join(tools, 'google-chrome');
    const stub = "#!/bin/sh\nprintf '%s\\n' 'marp-fixture 0.0.0'\n";
    writeFileSync(marp, stub); chmodSync(marp, 0o755);
    writeFileSync(browser, stub); chmodSync(browser, 0o755);
    const fixtureEnv = { PATH: tools, HOME: tmp };
    [rc_full, out] = run_ensure(nb, { env: fixtureEnv });
    check("ensure: marp and browser exit 0", equal(rc_full, 0) && contains(out, 'all formats'), "exit=" + String(rc_full));
    unlinkSync(marp);
    [rc_none, _] = run_ensure(nb, { env: fixtureEnv });
    check("ensure: missing marp exits 2", equal(rc_none, 2), "exit=" + String(rc_none));
    writeFileSync(marp, stub); chmodSync(marp, 0o755); unlinkSync(browser);
    [rc_html, out_html] = run_ensure(nb, { env: fixtureEnv });
    check("ensure: missing browser exits 1 (HTML only)", equal(rc_html, 1) && contains(out_html, "HTML"), "exit=" + String(rc_html));
    rmSync(tmp, { recursive: true, force: true });
    styles = read(join(REFS, "styles.md"));
    for ([label, needle] of iterable([["CJK font stack", "Pretendard"], ["Word-unit line breaks", "keep-all"], ["Minimum body size", "14pt"], ["Korean tracking differs from Latin", "tracking"], ["Per-style Korean mapping", "D2Coding"]])) {
        check(("Korean typesetting contract: " + String(label)), (contains(styles, needle)));
    }
    heads = regexFindall("(?m)^### ([A-Z])\\. ", styles);
    check("Three styles are retained", (equal(length(heads), 3)), (String(heads)));
    check("The reduction rationale is documented", (truth((contains(styles, "neither orthogonal"))) && truth((contains(styles, "monochrome print")))));
    notice = read(join(ROOT, "NOTICE"));
    check("NOTICE: complete MIT terms are preserved", (truth((contains(notice, "MIT License"))) && truth((contains(notice, "WITHOUT WARRANTY")))));
    check("NOTICE: original author is identified", (contains(notice, "corazzon")));
    check("NOTICE: observed absence of an upstream LICENSE file is recorded", (truth((contains(notice, "has no LICENSE file"))) || truth((contains(notice, "has no LICENSE file")))));
    have_pptx = ((spawnSync(python, ["-c", "import pptx"], { encoding: "utf8" }).status === 0 ? true : null) !== null);
    tmp2 = mkdtempSync(join(tmpdir(), "jstack-deck-"));
    md = join(tmp2, "mini.md");
    writeFileSync(md, "# 사업 개요\n\n- 요구사항 대응표를 먼저 만든다\n\n---\n\n# 추진 체계\n\n책임자 1인과 실무 3인.\n");
    out_pptx = join(tmp2, "out.pptx");
    [rc, txt] = run_py([ASSEMBLE, md, "-o", out_pptx]);
    if (truth(have_pptx)) {
        ok = (truth((equal(rc, 0))) && truth(existsSync(out_pptx)));
        detail = ("rc=" + String(rc) + " output=" + String(existsSync(out_pptx)));
    }
    else {
        ok = (truth((equal(rc, 2))) && truth((contains(txt, "requirements.txt"))));
        detail = ("missing-dependency route rc=" + String(rc));
    }
    check("assemble.py: create PPTX from small Markdown (exit 2 if dependencies are missing)", ok, detail);
    block_dir = join(tmp2, "block");
    mkdirSync(block_dir, { recursive: true });
    writeFileSync(join(block_dir, "pptx.py"), "raise ImportError(\"blocked for contract test\")\n");
    [rc, txt] = run_py([ASSEMBLE, md, "-o", join(tmp2, "x.pptx")], { env: { "PYTHONPATH": block_dir } });
    check("assemble.py: missing dependencies exit 2 with installation guidance", (truth((equal(rc, 2))) && truth((contains(txt, "requirements.txt"))) && truth((contains(txt, "python-pptx")))), ("rc=" + String(rc)));
    m = regexSearch("(\\d\\.\\d+)\\s*~\\s*(\\d\\.\\d+)", styles);
    src_asm = read(ASSEMBLE);
    m2 = regexSearch("(?m)^LINE_SPACING\\s*=\\s*([\\d.]+)", src_asm);
    [lo, hi] = (truth(m) ? [Number(m[1]), Number(m[2])] : [0.0, 0.0]);
    val = (truth(m2) ? Number(m2[1]) : -1.0);
    check("Line-height contract: assemble.py stays within the styles.md range", (truth(truth(m)) && truth(truth(m2)) && truth((lo <= val && val <= hi))), ("document " + String(lo) + "~" + String(hi) + " / code " + String(val)));
    [rc, txt] = run_py([PDF2PPTX]);
    check("pdf2pptx.py: missing arguments exit nonzero", (!equal(rc, 0)), ("rc=" + String(rc)));
    [rc, txt] = run_py([PDF2PPTX, "--help"]);
    check("pdf2pptx.py: help exits 0 and lists flags", (truth((equal(rc, 0))) && truth((contains(txt, "--skip-upscale")))), ("rc=" + String(rc)));
    src_pdf = read(PDF2PPTX);
    check("pdf2pptx.py: does not define call_gemini locally", (truth((!contains(src_pdf, "def call_gemini"))) && truth((contains(src_pdf, "call_gemini")))));
    check("pdf2pptx.py: loads the image skill's nanobanana.py by path", (truth((contains(src_pdf, "nanobanana.py"))) && truth((contains(src_pdf, "\"image\"")))));
    check("pdf2pptx.py: does not duplicate model IDs", (!contains(src_pdf, "generativelanguage.googleapis.com")));
    rmSync(tmp2, { recursive: true, force: true });
    reqs = (() => { const __items: any[] = []; for (const ln of iterable(read(REQS).split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
        __items.push(split(ln, "#", 1)[0].trim());
    } return __items; })();
    pkgs = sorted(new Set((() => { const __items: any[] = []; for (const r of iterable(reqs)) {
        if (!truth(r))
            continue;
        __items.push(r);
    } return __items; })()));
    check("requirements.txt: contains at least two packages", (length(pkgs) >= 2), (String(pkgs)));
    needed = new Set();
    for (src of iterable([src_asm, src_pdf])) {
        blk = regexSearch("(?ms)^DEPS\\s*=\\s*\\{(.*?)^\\}", src);
        if (truth(blk)) {
            needed = union(needed, new Set((() => { const __items: any[] = []; for (const [_k, v] of iterable(regexFindall("\"(\\w+)\":\\s*\"([a-z0-9-]+)\"", blk[1]))) {
                __items.push(v);
            } return __items; })()));
        }
    }
    absent = sorted((() => { const __items: any[] = []; for (const n of iterable(needed)) {
        if (!truth((!contains(pkgs, n))))
            continue;
        __items.push(n);
    } return __items; })());
    check("requirements.txt: includes every required distribution", (truth(truth(needed)) && truth((!truth(absent)))), (truth(absent) ? ("missing " + String(absent)) : (String(sorted(needed)))));
    orphan = (() => { const __items: any[] = []; for (const n of iterable(["scripts/assemble.py", "scripts/pdf2pptx.py", "requirements.txt"])) {
        if (!truth((!contains(skill, n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("SKILL.md references scripts and requirements", (!truth(orphan)), (truth(orphan) ? ("orphans " + String(orphan)) : ""));
    [refs_head, refs_sep, refs_tail] = partition(skill, "## References");
    check("Operational path: instructions open design-slop.md before the reference table", (truth((contains(refs_head, "references/design-slop.md"))) && truth((contains(refs_head, "`input`"))) && truth((contains(refs_head, "`no-verify`")))), (truth((!contains(refs_head, "references/design-slop.md"))) ? "no invocation instruction inside a phase" : ""));
    ref_table = split(refs_tail, "\n## ", 1)[0];
    listed = ["NOTICE", "requirements.txt"];
    listed.push(...(() => { const __items: any[] = []; for (const n of iterable(sorted(readdirSync(REFS)))) {
        if (!truth(n.endsWith(".md")))
            continue;
        __items.push(("references/" + String(n)));
    } return __items; })());
    listed.push(...(() => { const __items: any[] = []; for (const n of iterable(sorted(readdirSync(SCRIPTS)))) {
        if (!truth((!truth(starts(n, [".", "_"])))))
            continue;
        __items.push(("scripts/" + String(n)));
    } return __items; })());
    unlisted = (() => { const __items: any[] = []; for (const n of iterable(listed)) {
        if (!truth((!contains(ref_table, n))))
            continue;
        __items.push(n);
    } return __items; })();
    check("The reference table lists all supporting files", (truth(truth(refs_sep)) && truth(truth(listed)) && truth((!truth(unlisted)))), (truth(unlisted) ? ("not listed " + String(unlisted)) : (String(length(listed)) + " files")));
    own_skill = basename(resolve(ROOT));
    runnable = new Set(iterable(regexFindall((("\\$\\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\\}/skills/" + escapeRegex(own_skill)) + "/(scripts/[\\w.-]+)"), skill)));
    uncalled = (() => { const __items: any[] = []; for (const n of iterable(sorted(readdirSync(SCRIPTS)))) {
        if (!truth((truth((!truth(starts(n, [".", "_"])))) && truth((!contains(runnable, ("scripts/" + String(n))))))))
            continue;
        __items.push(("scripts/" + String(n)));
    } return __items; })();
    check("Execution instructions invoke every script through a body path", (!truth(uncalled)), (truth(uncalled) ? ("no invocation " + String(uncalled)) : (String(length(runnable)) + " calls")));
    helps = {};
    for ([fn_, path_] of iterable([["assemble.py", ASSEMBLE], ["pdf2pptx.py", PDF2PPTX]])) {
        [rc_h, txt_h] = run_py([path_, "--help"]);
        helps[fn_] = (truth((equal(rc_h, 0))) ? txt_h : "");
        check((String(fn_) + ": help exits 0"), (equal(rc_h, 0)), ("rc=" + String(rc_h)));
    }
    for ([fn_, mark] of iterable([["assemble.py", "slide_plan.json"], ["pdf2pptx.py", "--skip-upscale"]])) {
        other = Array.from((() => { const __items: any[] = []; for (const [k, v] of iterable(Object.entries(helps))) {
            if (!truth((!equal(k, fn_))))
                continue;
            __items.push(v);
        } return __items; })()).join("");
        check((String(fn_) + ": discriminating token `" + String(mark) + "` occurs only in its own help"), (truth((contains((helps[fn_] ?? ""), mark))) && truth((!contains(other, mark)))));
    }
    role_rows = Object.fromEntries(regexFindall("(?m)^\\|\\s*`scripts/(\\w+\\.py)`\\s*\\|([^|]*)\\|", skill));
    check("Phase 6: assemble.py maps manuscript/JSON to PPTX", (truth((contains((role_rows["assemble.py"] ?? ""), "slide_plan.json"))) && truth((!contains((role_rows["assemble.py"] ?? ""), "PDF")))), (role_rows["assemble.py"] ?? "no row").trim().slice(0, 60));
    check("Phase 6: pdf2pptx.py maps PDF to PPTX", (truth((contains((role_rows["pdf2pptx.py"] ?? ""), "PDF"))) && truth((!contains((role_rows["pdf2pptx.py"] ?? ""), "slide_plan.json")))), (role_rows["pdf2pptx.py"] ?? "no row").trim().slice(0, 60));
    tmp3 = mkdtempSync(join(tmpdir(), "jstack-deck-"));
    md3 = join(tmp3, "a.md");
    writeFileSync(md3, "# 사업 개요\n\n- 요구사항 대응표\n");
    [rc_opt, txt_opt] = run_py([ASSEMBLE, "--input", md3]);
    check("Argument contract: positional-input documentation matches execution", (truth((contains(skill, "Input is a **positional argument**"))) && truth((contains(skill, "not an option such as `--input`"))) && truth((!equal(rc_opt, 0))) && truth((contains(txt_opt, "unrecognized arguments")))), ("rc=" + String(rc_opt)));
    [rc_a1, _] = run_py([ASSEMBLE, join(tmp3, "missing.md")]);
    [rc_p1, _] = run_py([PDF2PPTX, join(tmp3, "missing.pdf")]);
    check("assemble.py: missing input exits 1", (equal(rc_a1, 1)), ("rc=" + String(rc_a1)));
    check("pdf2pptx.py: missing input exits 1", (equal(rc_p1, 1)), ("rc=" + String(rc_p1)));
    block3 = join(tmp3, "block");
    mkdirSync(block3, { recursive: true });
    writeFileSync(join(block3, "fitz.py"), "raise ImportError(\"blocked for contract test\")\n");
    dummy_pdf = join(tmp3, "x.pdf");
    writeFileSync(dummy_pdf, "");
    [rc_dep, txt_dep] = run_py([PDF2PPTX, dummy_pdf], { env: { "PYTHONPATH": block3 } });
    check("pdf2pptx.py: missing dependencies exit 2 with installation guidance", (truth((equal(rc_dep, 2))) && truth((contains(txt_dep, "requirements.txt")))), ("rc=" + String(rc_dep)));
    m_dep = regexSearch("exit (\\d) and installation guidance", skill);
    m_in = regexSearch("Exit (\\d) is an input error", skill);
    check("Exit-code contract: dependency/input documentation matches execution", (truth(truth(m_dep)) && truth(truth(m_in)) && truth((equal(Number(m_dep[1]), rc_dep))) && truth((equal(Number(m_in[1]), rc_a1)))), ("document " + String((truth(m_dep) && truth(m_dep[1]))) + "/" + String((truth(m_in) && truth(m_in[1]))) + " / observed " + String(rc_dep) + "/" + String(rc_a1)));
    ensure_decl = Object.fromEntries(regexFindall("(?m)^- exit (\\d) — (.+)$", skill));
    check("ensure three-state contract: documented codes match execution", (truth((contains((ensure_decl["0"] ?? ""), "all available"))) && truth((equal(rc_html, 1))) && truth((contains((ensure_decl["1"] ?? ""), "HTML only"))) && truth((equal(rc_none, 2))) && truth((contains((ensure_decl["2"] ?? ""), "marp is unavailable")))), ("document " + String(sorted(ensure_decl)) + " / observed missing=" + String(rc_none) + " browser-missing=" + String(rc_html)));
    plan_src = regexSearch("(?s)\\ndef parse_plan\\(.*?\\n\\ndef ", src_asm);
    plan_keys = (truth(plan_src) ? sorted(new Set(iterable(regexFindall("(?:s|plan)\\.get\\(\"(\\w+)\"", plan_src[0])))) : []);
    schema_doc = split(split(partition(skill, "### `slide_plan.json` schema")[2], "\n### ", 1)[0], "\n## ", 1)[0];
    undoc = (() => { const __items: any[] = []; for (const k of iterable(plan_keys)) {
        if (!truth((!contains(schema_doc, ("`" + String(k) + "`")))))
            continue;
        __items.push(k);
    } return __items; })();
    check("slide_plan.json: every consumed key is in the SKILL.md schema table", (truth(truth(plan_keys)) && truth((!truth(undoc)))), (truth(undoc) ? ("undocumented keys " + String(undoc)) : (String(plan_keys))));
    plan_path = join(tmp3, "plan.json");
    writeFileSync(plan_path, JSON.stringify({ "slides": [{ "slide_num": 1, "title": "사업 개요", "key_points": ["요구사항 대응표를 먼저 만든다"], "image_path": "", "speaker_notes": "발표 노트" }] }));
    plan_out = join(tmp3, "plan.pptx");
    [rc_j, txt_j] = run_py([ASSEMBLE, plan_path, "-o", plan_out]);
    if (truth(have_pptx)) {
        [ok_j, det_j] = [(truth((equal(rc_j, 0))) && truth(existsSync(plan_out))), ("rc=" + String(rc_j))];
    }
    else {
        [ok_j, det_j] = [(truth((equal(rc_j, 2))) && truth((contains(txt_j, "requirements.txt")))), ("missing-dependency route rc=" + String(rc_j))];
    }
    check("assemble.py: documented slide_plan.json schema assembles", ok_j, det_j);
    rmSync(tmp3, { recursive: true, force: true });
    [rc, txt] = run_py([STYLE_FONTS]);
    check("test_style_fonts.js passes (Korean font loss guard)", (equal(rc, 0)), (truth(txt.trim()) ? txt.trim().split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== "").at(-1)! : ("rc=" + String(rc))));
    [rc, txt] = run_py([SLOP_AXES]);
    check("[C-43] test_slop_axes.js passes (two tags and two axes)", (equal(rc, 0)), (truth(txt.trim()) ? txt.trim().split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== "").at(-1)! : ("rc=" + String(rc))));
    slop = read(join(REFS, "design-slop.md"));
    check("slop: declares original authorship", (contains(slop, "**Original work.**")));
    check("slop: explains upstream exclusion for its invented license tag", (contains(slop, "public-observed")));
    check("slop: forbids claiming an unavailable import", (contains(slop, "cannot claim to have imported\nunavailable material")));
    check("slop: identifies an evaluation checklist rather than an AI detector", (truth((contains(slop, "not an AI detector"))) && truth((contains(slop, "potential evaluation deductions")))));
    tags = regexFindall("(?m)^\\| `([a-z][a-z0-9-]*)` \\|", slop);
    check("slop: uses the two canonical cause tags (C-43)", (equal(sorted(new Set(iterable(tags))), ["input", "no-verify"])), (String(sorted(new Set(iterable(tags))))));
    check("slop: retains the C-43 four-to-two migration record", (truth((() => { const __items: any[] = []; for (const t of iterable(["median", "underspec", "no-constraint"])) {
        __items.push((contains(slop, ("`" + String(t) + "`"))));
    } return __items; })().every(truth)) && truth((contains(slop, "C-43 merged them into `input`")))));
    items = regexFindall("(?m)^\\| (\\d+) \\|", slop);
    check("slop: has at least twenty items", (length(items) >= 20), (String(length(items)) + " items"));
    check("slop: numbering is consecutive", (equal((() => { const __items: any[] = []; for (const i of iterable(items)) {
        __items.push(Number(i));
    } return __items; })(), Array.from(range(1, (length(items) + 1))))), (String(items)));
    check("slop: includes procurement reversals", (contains(slop, "Reversals in procurement")));
    check("slop: rejects forced exhaustive findings and fixes aggregated causes", (truth((contains(slop, "Do not force a finding for every item"))) && truth((contains(slop, "fixing the\ncause")))));
    check("slop: accepts no applicable findings", (contains(slop, "No findings is a valid result")));
    check("slop: explains the cost of invented findings", (contains(slop, "ignore the checklist")));
    check("slop: SKILL.md declares original work rather than an upstream crosswalk", (truth((contains(skill, "is original work"))) && truth((contains(skill, "not a crosswalk")))));
    const designPackDir = join(ROOT, "assets", "design-packs");
    const designPackNames = readdirSync(designPackDir).filter(name => name.endsWith(".md")).sort();
    for (const name of designPackNames) {
        const content = readFileSync(join(designPackDir, name), "utf8");
        check(`design pack: ${name} is substantive`, content.startsWith("#") && content.length >= 500, `${content.length}B`);
    }
    check_ref_contracts(check, ROOT, [["marp.md", "Browser dependency, non-editable PPTX, local-file warning, CJK fonts", ["--pptx-editable", "--browser", "--allow-local-files", "font-family"], 3148], ["design-slop.md", "21 deduction items, two cause tags, impact/cost axes, procurement reversals, original-work notice", ["**Original work.**", "not an AI detector", "`input`", "`no-verify`", "Two axes — deduction x cost", "Reversals in procurement", "No findings is a valid result"], 4517], ["styles.md", "Three substantive axes and concrete values for three styles", ["Background brightness", "Title typeface", "Decoration density", "Swiss", "#FFFFFF", "monochrome print"], 3993]]);
    ev = join(dirname(dirname(ROOT)), "evals", "discriminating", "deck-design-slop", "graders", "criteria.md");
    check("eval: discriminating-case criteria exist", isFile(ev));
    if (truth(isFile(ev))) {
        crit = read(ev);
        real = {};
        for (m of iterable([...slop.matchAll(regex("(?m)^### (.+)$", "g"))])) {
            body = split(split(slop.slice((m.index + m[0].length)), "\n### ", 1)[0], "\n## ", 1)[0];
            real[m[1].trim()] = length(regexFindall("(?m)^\\| \\d+ \\|", body));
        }
        declared = Object.fromEntries(iterable(regexFindall("(?m)^\\| ([^|]+?) \\| (\\d+) \\|\\s*$", crit)).map(([k, v]: any) => [k.trim(), Number(v)]));
        check("eval: criteria section counts match the actual document", (equal(declared, real)), ("criteria " + String(declared) + " / actual " + String(real)));
        crit_tags = sorted(new Set(iterable(regexFindall("`([a-z][a-z0-9-]*)`", crit))));
        unknown = (() => { const __items: any[] = []; for (const t of iterable(crit_tags)) {
            if (!truth((!contains(slop, ("`" + String(t) + "`")))))
                continue;
            __items.push(t);
        } return __items; })();
        check("eval: every criterion tag is in design-slop.md vocabulary", (truth(truth(crit_tags)) && truth((!truth(unknown)))), (truth(unknown) ? ("unknown document tags " + String(unknown)) : (String(crit_tags))));
    }
    check_skill_body(check, ROOT, { needles: ["until a person opens it", "disappear in monochrome print", "For procurement, the default is Swiss", "Korean font contract"], floor: 3265 });
    check_no_constant_assertions(check, __file__);
    live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) {
        if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))))
            continue;
        __items.push(1);
    } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    for (const [file, needles] of [["LICENSE.pptx-design-styles", ["MIT License", "Permission is hereby granted", "corazzon/pptx-design-styles"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
    check_contract_coverage(check, __file__, ROOT, { per_file: {"LICENSE.pptx-design-styles": 1,  "NOTICE": 3, "SKILL.md": 23, "references/design-slop.md": 17, "references/marp.md": 10, "references/styles.md": 12, ...Object.fromEntries(designPackNames.map(name => [`assets/design-packs/${name}`, 1])) }, live_ran: live_ran });
    check_body_deletion(check, __file__, ROOT, { minimum: 48, extra_strip: ["references/marp.md", "references/styles.md", "NOTICE"], live_ran: live_ran });
    check_script_contracts(check, __file__, ROOT, { scripts: { "scripts/ensure_marp.js": 4, "scripts/assemble.py": 9, "scripts/pdf2pptx.py": 8 }, live_ran: live_ran });
    check_total(check, results, 184);
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
