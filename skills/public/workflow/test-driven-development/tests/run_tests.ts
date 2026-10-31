/** TDD owning contracts: document polarity, actual approval/diff gates, and deletion floors. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runProcess } from '../../../../../runtime/os.js';
import { check_no_constant_assertions, check_total, check_skill_body, check_ref_contracts, split_frontmatter, check_body_deletion, check_contract_coverage, check_script_contracts, type Result } from '../../../../_suite_lib.js';
import { truth, length, contains, unique, sorted, repr, at, slice, strip, lstrip, rstrip, split, lines, count, starts, ends, lower, joinText, replace, findall, finditer, search, match, group, sub, isdir, isinstance, temporaryDirectory, removeTree, range, isdigit, enumerate } from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),LANGS=join(ROOT,'langs'),GATES=join(ROOT,'scripts','test_gates.js'),FIX=join(dirname(SUITE_FILE),'fixtures');
const results:Result[]=[];
function check(name:string,ok:boolean,detail=''):void{results.push([name,ok,detail]);console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
const read=(p:string)=>readFileSync(p,'utf8'),fx=(name:string)=>join(FIX,name);
function gate(...args:string[]):[number,string]{return gate_env({},...args);}
function gate_env(extra:NodeJS.ProcessEnv,...args:string[]):[number,string]{const r=runProcess(process.execPath,[GATES,...args],{cwd:ROOT,env:{...process.env,...extra}});return [r.status??-1,r.stdout+r.stderr];}
function last_line(out:string):string{const measured=lines(out.trim()).filter(line=>line.trim());return measured.length?measured.at(-1)!.slice(0,70):'no output';}
function rows(label:string,text:string,wanted:string[]):void{const lost=wanted.filter(row=>!text.includes(row));check(label,lost.length===0,`mismatched rows ${JSON.stringify(lost.map(row=>row.slice(0,44)))}`);}
function polarity(label:string,text:string,present:string[],forbidden:string[]):void{const miss=present.filter(needle=>!text.includes(needle)),bad=forbidden.filter(needle=>text.includes(needle));check(label,!miss.length&&!bad.length,`missing ${JSON.stringify(miss.map(n=>n.slice(0,36)))} · reversed ${JSON.stringify(bad.map(n=>n.slice(0,36)))}`);}
function split_fence(text:string):[string[],string[]]{let inside=false;const fenced:string[]=[],prose:string[]=[];for(const ln of lines(text)){if(ln.trimStart().startsWith('```')){inside=!inside;continue;}(inside?fenced:prose).push(ln);}return [fenced,prose];}
function walk(root:string):[string,string[],string[]][]{const entries=readdirSync(root,{withFileTypes:true}),dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name),files=entries.filter(e=>!e.isDirectory()).map(e=>e.name);return [[root,dirs,files],...dirs.flatMap(name=>walk(join(root,name)))];}
const SKILL_FLOOR:any=4413;
const [C_FLOOR, GO_FLOOR, JAVA_FLOOR, JS_FLOOR]:any=[7133, 7249, 8844, 6568];
const [PY_FLOOR, RUST_FLOOR, TS_FLOOR, ANTI_FLOOR]:any=[9638, 7016, 7091, 7183];
const PER_FILE:any={"SKILL.md": 47, "langs/c.md": 7, "langs/go.md": 6, "langs/java.md": 6, "langs/javascript.md": 6, "langs/python.md": 8, "langs/rust.md": 6, "langs/typescript.md": 6, "references/antipatterns.md": 10, "references/test-budget.md": 3, "references/test-portfolio.md": 3, "NOTICE": 1};
const BODY_MIN:any=47;
const GATE_MIN:any=29;
const TOTAL:any=141;
const TEST_BUDGET_FLOOR:any=4247;
const TEST_PORTFOLIO_FLOOR:any=2393;
const FAIL_UNDER:any="90";
const FU_SITES:any={"SKILL.md": 1, "langs/c.md": 2, "langs/go.md": 2, "langs/java.md": 2, "langs/javascript.md": 2, "langs/python.md": 2, "langs/rust.md": 2, "langs/typescript.md": 3};
const BACKDOOR_ENV:any=["SKIP", "SKIP_GATES", "TDD_SKIP", "TDD_SKIP_GATES", "NO_GATE", "NO_GATES", "DISABLE_GATES", "GATE_BYPASS", "FORCE_PASS", "COVERAGE_SKIP", "CI_SKIP", "ALLOW_UNMEASURED", "FAIL_UNDER", "TDD_FAIL_UNDER", "DIFF_COVERAGE_SKIP"];
const PLACEHOLDER_INPUTS:any=["TBD", "todo", "미정", "<name>", "-", "N/A", "없음", "undecided", "none"];
const DETECT_ROWS:any=["| `tsconfig.json` | `langs/typescript.md` |", "| `package.json` (no tsconfig) | `langs/javascript.md` |", "| `pyproject.toml` · `setup.py` · `requirements.txt` | `langs/python.md` |", "| `Cargo.toml` | `langs/rust.md` |", "| `go.mod` | `langs/go.md` |", "| `pom.xml` · `build.gradle` | `langs/java.md` |", "| `CMakeLists.txt` · `configure.ac` · `meson.build` · `Makefile` **with `*.c`** | `langs/c.md` |"];
const SLICE_ROWS:any=["| A slice | Not a slice |", "| \"Log in with email and land on the dashboard\" | \"Build the User model\" |", "| Runs end to end and **demonstrates behaviour** | Does nothing until other layers exist |"];
const BOUNDARY_ROWS:any=["| Task | Owner |", "| Completion judgment, requirement coverage | `verify` skill |", "| Deciding what to build | `plan` skill |", "| Judging existing code quality | `audit` skill |"];
const LEVEL_ROWS:any=["| Level | May be replaced by test doubles | Must be real |", "| unit | All out-of-process dependencies | SUT and its value objects |", "| integration | External SaaS · Payment providers | DB · Queue · ORM mappings · Migrations |", "| e2e | None (or payment sandbox) | Entire path |", "| smoke | None | Deployed artifact |"];
const COST_ROWS:any=["| Anti-pattern | What collapses |", "| Flaky tests | Trust in the entire CI.", "| Order dependency | Locality of failure.", "| Excessive mock | The subject of verification. What passes is not the code but the mock |"];
const XO_PAIRS:any=["[X] wait for asynchronous completion with sleep", "[O] wait for a completion signal or inject a clock", "[X] base a verdict on unseeded randomness, UUIDs, or hash iteration order", "[O] fix the seed (seed=42) or inject the generator", "[X] use a real HTTP endpoint, real DNS, a shared development DB, or fixed port (:8080)", "[O] use an in-process test server (httptest.NewServer, msw, responses)", "[X] accumulate state in module globals, singletons, or class variables", "[O] have each test create and undo its own fixture", "[X] mock the SUT itself; this is a meaningless test", "[O] replace only boundaries: network, clock, filesystem, and randomness"];
const SWAPPED_HEADERS:any=["| Not a slice | A slice |", "| Owner | Task |", "| Level | Must be real | May be replaced by test doubles |", "| What collapses | Anti-pattern |", "| Load | Detected |"];
const DIFF_SECTION_HEAD:any="## diff coverage — gate only for new code";
function main():number {
let META:any, _:any, _dirs:any, addopts:any, anti:any, bad:any, body:any, cmd:any, cov_off:any, dirpath:any, f:any, fenced:any, files:any, fm:any, fname:any, got:any, gsrc:any, h:any, hostile:any, i:any, in_table:any, inside:any, k:any, ko_triggers:any, live_ran:any, ln:any, lost:any, lost_xo:any, miss:any, missing:any, n:any, n_all:any, n_neg:any, named:any, needle:any, norows:any, off:any, ok:any, on_disk:any, out:any, out2:any, out3:any, passed:any, ph:any, plan_body:any, pout:any, pp:any, prc:any, prose:any, py:any, r:any, rc:any, rc2:any, rc3:any, rel:any, relp:any, sect:any, skill:any, skills_dir:any, stray:any, survived:any, swapped:any, swapped_anti:any, t:any, thin:any, tmpd:any, unbuilt:any, vals:any, want:any, want_n:any, why:any, wrong:any, x:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(on_disk=Array.from(readdirSync(LANGS)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (f)));
check("lazy: seven language guides exist", (length(on_disk) === 7), (repr(sorted(on_disk))));
(in_table=unique(findall("`langs/([a-z]+\\.md)`", skill)));
check("lazy: detection table points to all seven guides", isDeepStrictEqual(sorted(in_table), sorted(on_disk)), ("table only " + repr(sorted(in_table.filter((name:string)=>!on_disk.includes(name)))) + " / files only " + repr(sorted(on_disk.filter((name:string)=>!in_table.includes(name))))));
check("lazy: explicitly forbids reading the remaining guides", (contains(skill, "Do not read the others")));
check("lazy: asks when detection fails (no guessing)", (truth((contains(skill, "If detection fails, ask"))) && truth((contains(skill, "Guessing the framework wrong")))));
check("lazy: discloses ambiguous C detection", (truth((contains(skill, "`Makefile` alone decides nothing"))) && truth((contains(skill, "mixed C/C++ tree is a question for the")))));
check("Always read: cites the language-independent anti-pattern document", (truth((contains(skill, "`references/antipatterns.md`"))) && truth((contains(skill, "visible or invisible depending on what the project was written in")))));


rows("Phase 0: seven detection rows preserve their values (rotation and row deletion)", skill, DETECT_ROWS);
rows("Phase 1: slice-comparison rows preserve their values", skill, SLICE_ROWS);
rows("Boundary: redirection-table rows preserve their values", skill, BOUNDARY_ROWS);
(swapped=Array.from(SWAPPED_HEADERS).filter((h: any) => truth((contains(skill, h)))).map((h: any) => (h)));
check("Table: SKILL.md contains no swapped-column header", !truth(swapped), (repr(swapped)));
(thin=Array.from(sorted(on_disk)).filter((f: any) => truth((length(strip(read(join(LANGS, f)))) < 400))).map((f: any) => (f)));
check("lazy: guides contain substantive text (>= 400 characters)", !truth(thin), ("thin " + repr(thin)));
check("red: requires watching the failure", (contains(skill, "watch it fail")));
check("red: a test whose failure was not observed is not a test", (contains(skill, "A test whose failure you never saw is not a test")));
check("red: names what a green-only harness costs", (contains(skill, "round\nafter round of review unnoticed")), "A green-only harness carries a defect through repeated review");
check("Slice: defines a vertical slice", (truth((contains(skill, "thin vertical slice"))) && truth((contains(skill, "end to end")))));
check("Slice: prohibits splitting work by layer", (truth((contains(skill, "Do not slice by layer"))) && truth((contains(skill, "is not a slice")))));
check("Slice: supplies a criterion (one more working behavior)", (contains(skill, "must add one thing that runs")));
check("Slice: contrasts good and bad examples", (contains(skill, "| A slice | Not a slice |")));
check("Gate: scenario approval is required", (truth((contains((fm + skill), "[approval required]"))) || truth((contains(skill, "approval required")))));
check("Gate: prohibits proceeding without approval", (contains(skill, "Do not proceed without the user's approval")));
check("Gate: limitations identify approval as a human step", (truth((contains(skill, "human step"))) && truth((contains(skill, "never automatic")))));
check("Gate: cites a mechanism for checking both approvals", (truth((contains(skill, "test_gates.js approvals"))) && truth((contains(skill, "a rule with no enforcement")))));
{const td=temporaryDirectory();try{const seg=skill.split('```').find((part:string)=>part.includes('Scenario-Approved-By:'))??'';const pp=join(td,'skill_plan.md');writeFileSync(pp,seg);const [prc,pout]=gate('approvals','--plan',pp);check("Gate: the approval example in SKILL.md passes the approvals checker",prc===0&&contains(pout,'two approvals are recorded'),`rc=${prc}`);}finally{removeTree(td,{ignore_errors:true});}}
check("Gate: drafting and scratch probes proceed and are reported; building waits for approval", (contains(skill, "**What waits and what does not.**") && contains(skill, "local and reversible") && contains(skill, "say in your\nreply what you drafted or ran") && contains(skill, "ask first") && contains(skill, "Everything from Phase 3 on is built")));
check("Bug fix: a cheap local test fails before the fix, otherwise the closest executable check with the reason", (contains(skill, "## Fixing a bug") && contains(skill, "watch it fail for the reason in the report") && contains(skill, "**No new test beats a bad one:**") && contains(skill, "say why there is no failing test") && contains(skill, "failing-before")));
check("uv: no language guide or SKILL.md tells the reader to run pip or pipx", (!sorted(on_disk).some((f:string)=>/\bpipx?\s+install\b|\bpython3?\s+-m\s+pip\b/.test(read(join(LANGS,f)))) && !/\bpipx?\s+install\b/.test(skill)));
check("Gate: cites diff coverage instead of an absolute threshold", (truth((contains(skill, "test_gates.js diff-coverage"))) && truth((contains(skill, "not an absolute threshold"))) && truth((contains(skill, "lines this change added"))) && truth((contains(skill, "../verify/SKILL.md#the-diff-coverage-gate")))));
polarity("Polarity: prohibition on proceeding without approval has not reversed", skill, ["**Do not proceed without the user's approval.**", "**Scenario approval is a human step.** It is never automatic"], ["may proceed without the user", "Proceed without", "approval is optional", "approval is automatic", "proceed without waiting", "It is automatic", "approval when the scenarios are obvious"]);
(n_all=count(skill, "proceed without the user's approval"));
(n_neg=count(skill, "Do not proceed without the user's approval"));
check("Polarity: every phrase about proceeding without approval occurs under negation", (truth((n_all === n_neg)) && truth((n_neg >= 1))), ("total " + repr(n_all) + " · negated " + repr(n_neg)));
polarity("Polarity: requirement to observe red has not reversed", skill, ["**watch it fail**", "**A test whose failure you never saw is not a test.**"], ["watch it pass", "is still a test", "you never saw is a test", "Skipping the red step is acceptable", "seeing red is optional"]);
check("Polarity: every occurrence of watch it is watch it fail", (count(skill, "watch it") === count(skill, "watch it fail")), ("total " + repr(count(skill, "watch it")) + " / fail " + repr(count(skill, "watch it fail"))));
polarity("Polarity: diff-gate reference has not reversed into absolute-threshold advocacy", skill, ["not an absolute threshold", "Gate the **lines this change added**"], ["Absolute coverage thresholds are the", "Gate the whole repository", "absolute threshold instead", "Absolute coverage thresholds do not"]);
for (const [needle, why] of [["Batching tests afterwards", "batching tests afterwards"], ["Several scenarios in one test", "multiple scenarios in one test"], ["Mock overuse", "mock overuse"], ["Skipping the red step", "skipping red"]]) {
check(("Failure example: documents " + repr(why)), (contains(skill, needle)));
}
(skills_dir=dirname(ROOT));
(named=unique(findall("`([a-z][a-z-]{2,})`\\s*skill(?!\\s*\\*\\*\\(not built yet\\)\\*\\*)", skill)));
(unbuilt=unique(findall("`([a-z][a-z-]{2,})`\\s*skill\\s*\\*\\*\\(not built yet\\)\\*\\*", skill)));
named=named.filter((name:string)=>!unbuilt.includes(name));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(skills_dir, n))))).map((n: any) => (n)));
check("Boundary: redirection target population is nonempty", (length(named) >= 2), (repr(sorted(named))));
(wrong=Array.from(unbuilt).filter((n: any) => truth(isdir(join(skills_dir, n)))).map((n: any) => (n)));
check("Boundary: not-built-yet notices identify actual missing skills", !truth(wrong), ("exists but marked not built " + repr(wrong)));
check("Boundary: every redirection target exists", !truth(missing), ("missing " + repr(missing)));
check("Boundary: delegates completion judgment to verify", (contains(skill, "Completion is judged by the `verify` skill")));
check("Boundary: distinguishes tests passing from requirements being satisfied", (contains(skill, "are different questions")));
(ko_triggers=findall("[가-힣]+", fm));
check("Language: description names the Korean activation intent", ["테스트 먼저"].every(term => fm.includes(term)));
check("Language: description also includes English triggers", (Array.from(["tdd", "test-first", "refactor"]).map((t: any) => ((contains(fm.toLowerCase(), t))))).every((value:any)=>truth(value)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_full.info")));
check("Gate: passes fully covered new lines", (truth((rc === 0)) && truth((contains(out, "100.0%")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_partial.info")));
check("Gate: insufficient new-line coverage returns rc 1", (truth((rc === 1)) && truth((contains(out, "50.0%")))), ("rc=" + repr(rc)));
check("Gate: identifies uncovered line numbers as ranges", (truth((contains(out, "[MISS] "))) && truth((contains(out, "calc.py: 12-13")))), (slice(strip(out),0,60) || "no output"));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_partial.info"), "--fail-under", "40"));
check("Gate: lowering the floor passes the same input (return code is not constant)", (truth((rc === 0)) && truth((contains(out, "[PASS] diff coverage")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_go.patch"), "--coverage", fx("cover.out")));
check("Gate: reads Go coverprofile (matches module-path prefixes by suffix)", (truth((rc === 0)) && truth((contains(out, "format: go")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("cobertura.xml")));
check("Gate: reads Cobertura XML", (truth((rc === 1)) && truth((contains(out, "format: cobertura"))) && truth((contains(out, "25.0%")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_java.patch"), "--coverage", fx("jacoco.xml")));
check("Gate: maps JaCoCo package paths to file paths", (truth((rc === 1)) && truth((contains(out, "format: jacoco"))) && truth((contains(out, "Calc.java")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_docs.patch"), "--coverage", fx("lcov_full.info")));
check("Gate: passes when there are no executable new lines", (truth((rc === 0)) && truth((contains(out, "no executable new lines")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_newfile.patch"), "--coverage", fx("lcov_full.info")));
check("Gate: detects new source completely absent from the report", (truth((rc === 1)) && truth((contains(out, "untested.py"))) && truth((contains(out, "it was never measured")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_newfile.patch"), "--coverage", fx("lcov_full.info"), "--allow-unmeasured"));
check("Gate: --allow-unmeasured downgrades that verdict to a warning", (truth((rc === 0)) && truth((contains(out, "[WARN]")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("plan_ok.md")));
check("Gate: unrecognized coverage format returns rc 2 instead of passing", (truth((rc === 2)) && truth((contains(out, "cannot detect coverage format")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("missing-file.info")));
check("Gate: missing input also returns rc 2 instead of silently passing", (truth((rc === 2)) && truth((contains(out, "file not found")))), ("rc=" + repr(rc)));
([rc, out]=gate("approvals", "--plan", fx("plan_ok.md")));
check("Approval: passes a plan recording both approvals", (truth((rc === 0)) && truth((contains(out, "two approvals are recorded")))), ("rc=" + repr(rc)));
([rc, out]=gate("approvals", "--plan", fx("plan_no_case_approval.md")));
check("Approval: missing case approval returns rc 1", (truth((rc === 1)) && truth((contains(out, "no case approval record")))), ("rc=" + repr(rc)));
([rc, out]=gate("approvals", "--plan", fx("plan_placeholder.md")));
check("Approval: detects a placeholder approval (TBD)", (truth((rc === 1)) && truth((contains(out, "placeholder")))), ("rc=" + repr(rc)));
([rc, out]=gate("approvals", "--plan", fx("plan_out_of_order.md")));
check("Approval: detects case approval preceding scenario approval", (truth((rc === 1)) && truth((contains(out, "order is a gate")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_partial.info")));
check(("Gate: omitted arguments use floor " + repr(FAIL_UNDER) + ".0% (verified from output)"), (truth((rc === 1)) && truth((contains(out, ("floor " + repr(FAIL_UNDER) + ".0%"))))), ("rc=" + repr(rc) + " · " + repr(last_line(out))));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_partial.info"), "--fail-under", "50"));
check("Gate: a value exactly equal to the floor passes (>= boundary)", (truth((rc === 0)) && truth((contains(out, "[PASS] diff coverage 50.0%")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_partial.info"), "--fail-under", "50.1"));
check("Gate: a value 0.1 below the floor fails (opposite boundary)", (truth((rc === 1)) && truth((contains(out, "[FAIL] diff coverage 50.0%")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_mixed.patch"), "--coverage", fx("lcov_mixed.info")));
check("Gate: mixed context/deletion/addition hunks yield correct new-line numbers", (truth((rc === 1)) && truth((contains(out, "50.0% (1/2 new lines"))) && truth((contains(out, "mix.py: 10\n")))), ("rc=" + repr(rc) + " · " + repr(last_line(out))));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_multi.patch"), "--coverage", fx("lcov_multi.info")));
check("Gate: sums new lines across two files instead of stopping at the first", (truth((rc === 1)) && truth((contains(out, "changed files 2"))) && truth((contains(out, "50.0% (2/4 new lines"))) && truth((contains(out, "two.py: 5-6")))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_two_new.patch"), "--coverage", fx("lcov_full.info")));
check("Gate: identifies both unmeasured new files", (truth((rc === 1)) && truth((contains(out, "alpha.py"))) && truth((contains(out, "beta.py"))) && truth((count(out, "it was never measured") === 2))), ("rc=" + repr(rc)));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_go.patch"), "--coverage", fx("cover.out")));
check("Gate: counts every line from start through end of a Go block (4/4)", (truth((rc === 0)) && truth((contains(out, "100.0% (4/4 new lines")))), ("rc=" + repr(rc) + " · " + repr(last_line(out))));
([rc, out]=gate("diff-coverage", "--diff", fx("diff_jacoco_dup.patch"), "--coverage", fx("jacoco_ambiguous.xml")));
check("Gate: distinguishes identical filenames by package", (truth((rc === 1)) && truth((contains(out, "0.0% (0/2 new lines")))), ("rc=" + repr(rc) + " · " + repr(last_line(out))));
(hostile=Object.fromEntries(Array.from(BACKDOOR_ENV).map((k: any) => ([k, "1"]))));
([rc, out]=gate_env(hostile, "diff-coverage", "--diff", fx("diff_py.patch"), "--coverage", fx("lcov_partial.info")));
([rc2, out2]=gate_env(hostile, "approvals", "--plan", fx("plan_placeholder.md")));
check("Backdoor: disabling environment variables leave both verdicts at rc 1", (truth((rc === 1)) && truth((contains(out, "50.0%"))) && truth((rc2 === 1)) && truth((contains(out2, "placeholder")))), ("diff rc=" + repr(rc) + " · approvals rc=" + repr(rc2)));
(gsrc=read(GATES));
check("Backdoor: checker never reads the environment (zero process.env access)", (truth((!/process\s*(?:\.\s*env|\[\s*[\'\"]env[\'\"]\s*\])/.test(gsrc))) && truth((!contains(gsrc, "getenv")))), ("environ " + repr(count(gsrc, "environ")) + " · getenv " + repr(count(gsrc, "getenv"))));
(plan_body=read(fx("plan_ok.md")));
([survived, tmpd]=[[], temporaryDirectory()]);
try {
for (const [i, ph] of enumerate(PLACEHOLDER_INPUTS)) {
(pp=join(tmpd, ("plan_" + repr(i) + ".md")));
writeFileSync(pp, replace(plan_body, "Case-Approved-By: Test Approver 2026-09-02", ("Case-Approved-By: " + repr(ph))));
([prc, pout]=gate("approvals", "--plan", pp));
if(truth(!truth((truth((prc === 1)) && truth((contains(pout, "placeholder"))))))) {
survived.push(ph);
}
}
(norows=join(tmpd, "plan_no_rows.md"));
writeFileSync(norows, "# TEST_PLAN\n\nScenario-Approved-By: Test Approver 2026-09-02\n\nCase-Approved-By: Test Approver 2026-09-03\n");
([rc3, out3]=gate("approvals", "--plan", norows));
} finally {
removeTree(tmpd, {ignore_errors: true});
}
check("Approval: rejects every placeholder (zero slack)", !truth(survived), ("surviving placeholders " + repr(survived)));
check("Approval: rejects approval-only plans without TS/TC rows", (truth((rc3 === 1)) && truth((contains(out3, "no scenario row (TS-NNN)"))) && truth((contains(out3, "no test-case row (TC-NNN)")))), ("rc=" + repr(rc3)));
(off=[]);
for (const [rel, want_n] of sorted(Object.entries(FU_SITES))) {
(vals=findall("--fail-under[= ](\\d+(?:\\.\\d+)?)", read(join(ROOT,rel))));
if(truth((truth((length(vals) !== want_n)) || truth(!isDeepStrictEqual(unique(vals), [FAIL_UNDER]))))) {
off.push((repr(rel) + " -> " + repr(vals)));
}
}
check(("Single value: all " + repr((Object.values(FU_SITES)).reduce((total:number,value:any)=>total+Number(value),0)) + " --fail-under sites in " + repr(length(FU_SITES)) + " files equal " + repr(FAIL_UNDER) + " (zero slack)"), !truth(off), ("mismatches " + repr(off)));
(stray=[]);
for (const [dirpath, _dirs, files] of walk(ROOT)) {
if(truth((contains(split(relative(ROOT,dirpath), sep), "tests")))) {
continue;
}
for (const fname of files) {
if(truth(!truth(ends(fname, ".md")))) {
continue;
}
(relp=relative(ROOT,join(dirpath,fname)));
if(truth((truth((!contains(FU_SITES, relp))) && truth(search("--fail-under[= ](\\d+(?:\\.\\d+)?)", read(join(dirpath,fname))))))) {
stray.push(relp);
}
}
}
check("Single value: no unlisted document contains --fail-under", !truth(stray), ("unlisted " + repr(stray)));
check("Single value: checker default equals the documented value", (new RegExp("fail_under:\\s*"+FAIL_UNDER+"\\b").test(gsrc)), "declared default diverges from documentation");
(anti=read(join(ROOT, "references", "antipatterns.md")));
check("Anti-pattern: provides alternatives for all three nondeterminism axes", (truth((Array.from(["vi.useFakeTimers()", "freezegun", "tokio::time::advance()", "seed=42", "httptest.NewServer", "port 0"]).map((x: any) => ((contains(anti, x))))).every((value:any)=>truth(value))) && truth((contains(anti, "sleep")))));
check("Anti-pattern: supplies commands to reproduce order dependence", (truth((contains(anti, "go test -shuffle=on"))) && truth((contains(anti, "pytest -p randomly"))) && truth((contains(anti, "Passing once in shuffled order is not evidence")))));
check("Anti-pattern: table fixes permitted test doubles by level", (truth((contains(anti, "| unit | All out-of-process dependencies |"))) && truth((contains(anti, "/generate-test --level"))) && truth((contains(anti, "produces a unit test")))));
check("Anti-pattern: each item explains what it breaks", (truth((contains(anti, "What collapses"))) && truth((contains(anti, "Trust in the entire CI"))) && truth((contains(anti, "What passes is not the code but the mock")))));
rows("Anti-pattern: permitted-double table rows preserve their values", anti, LEVEL_ROWS);
rows("Anti-pattern: cost table rows preserve their values", anti, COST_ROWS);
(lost_xo=Array.from(XO_PAIRS).filter((x: any) => truth((!contains(anti, x)))).map((x: any) => (x)));
check("Anti-pattern: all ten [X]/[O] pairs survive (detects swapping)", !truth(lost_xo), ("mismatched pairs " + repr(Array.from(lost_xo).map((x: any) => (slice(x, 0, 36))))));
(swapped_anti=Array.from(SWAPPED_HEADERS).filter((h: any) => truth((contains(anti, h)))).map((h: any) => (h)));
check("Table: antipatterns.md contains no swapped-column header", !truth(swapped_anti), (repr(swapped_anti)));
(py=read(join(LANGS, "python.md")));
(addopts=Array.from(lines(py)).filter((ln: any) => truth(starts(strip(ln), "addopts"))).map((ln: any) => (ln)));
check("F-9: addopts contains no absolute coverage threshold", (Array.from(addopts).map((ln: any) => ((!contains(ln, "cov-fail-under"))))).every((value:any)=>truth(value)), (repr(addopts)));
check("F-11: corrects the Google citation to three bands and explains retirement", (truth((contains(py, "60%"))) && truth((contains(py, "75%"))) && truth((contains(py, "90%"))) && truth((contains(py, "explicitly cautions"))) && truth((contains(py, "Python-only tax")))));

(cov_off=[]);
for (const rel of ["SKILL.md", "references/antipatterns.md", ...Array.from(sorted(on_disk)).map((f: any) => "langs/" + repr(f))]) {
([fenced, prose]=split_fence(read(join(ROOT, rel))));
(got=[(Array.from(fenced).filter((ln: any) => truth((contains(ln, "cov-fail-under")))).map((ln: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0), (Array.from(prose).filter((ln: any) => truth((contains(ln, "cov-fail-under")))).map((ln: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)]);
(want=(truth((rel === "langs/python.md")) ? [0, 3] : [0, 0]));
if(truth(!isDeepStrictEqual(got,want))) {
cov_off.push((repr(rel) + " code blocks " + repr(at(got, 0)) + " · prose " + repr(at(got, 1))));
}
}
check("F-9: --cov-fail-under occurs only in three python.md prose locations and no code block", !truth(cov_off), ("mismatches " + repr(cov_off)));
(sect=[]);
for (const f of sorted(on_disk)) {
(body=read(join(LANGS, f)));
if(truth((!contains(body, DIFF_SECTION_HEAD)))) {
sect.push((repr(f) + ": diff coverage section heading missing"));
}
for (const ln of lines(body)) {
if(truth((truth((contains(ln, "diff coverage"))) && truth((truth((contains(ln, "폐기"))) || truth((contains(ln, "더 이상"))) || truth((contains(lower(ln), "discarded"))) || truth((contains(lower(ln), "no longer"))) || truth((contains(lower(ln), "deprecated")))))))) {
sect.push((repr(f) + ": retirement declaration — " + repr(slice(strip(ln), 0, 40))));
}
}
}
check("Section presence: all seven guides retain diff coverage without retirement notices", !truth(sect), (repr(sect)));
(cmd=read(join(LANGS, "c.md")));
check("Section presence: c.md preserves the MC/DC section and DO-178C level mapping", (truth((contains(cmd, "## Safety Related Code — MC/DC"))) && truth((contains(cmd, "MC/DC is required for **Level A** (catastrophic failure) software according to DO-178C, while Level B"))) && truth((contains(cmd, "requires decision coverage and Level C requires statement coverage"))) && truth((contains(cmd, "-fcoverage-mcdc")))), "MC/DC section was rotated or deleted");
check("Limits: diff gate does not measure correctness", (truth((contains(skill, "measures coverage, not correctness"))) && truth((contains(skill, "tautological assertion still counts as covered")))));
check("Limits: states that there are seven language guides", (contains(skill, "cover **seven** languages")));
check_skill_body(check, ROOT, {needles: ["watch it fail", "Do not slice by layer", "Do not read the others", "must add one thing that runs", "human step", "test_gates.js diff-coverage", "`references/antipatterns.md`"], floor: SKILL_FLOOR});
check_ref_contracts(check, ROOT, [["c.md", "Unity/gtest, linker seams, gcov branches, MC/DC", ["Unity", "`--wrap`", "gcov -b", "MC/DC", "DO-178C", "diff coverage"], C_FLOOR], ["go.md", "table-driven tests, interface mocking, stdlib vs testify, diff gate", ["Table-Driven Tests", "Interface-Based Mocking", "testify", "diff coverage"], GO_FLOOR], ["java.md", "JUnit 5, Mockito annotation distinctions, AssertJ, diff gate", ["@Mock vs @InjectMocks vs @Spy", "AssertJ", "AAA Pattern", "diff coverage"], JAVA_FLOOR], ["javascript.md", "framework selection, mock strategy, async testing, diff gate", ["Mock Strategy", "Asynchronous Testing", "AAA Pattern", "diff coverage"], JS_FLOOR], ["python.md", "three-step design protocol, scenarios, threshold retirement, diff gate", ["Three-step test design protocol", "Test Scenarios", "AAA Pattern", "diff coverage"], PY_FLOOR], ["rust.md", "cfg(test) philosophy, unit/integration distinction, mockall, diff gate", ["`#[cfg(test)]` Philosophy", "Unit Testing vs Integration Testing", "mockall", "diff coverage"], RUST_FLOOR], ["typescript.md", "type-safe mocks, three tsconfig files, NestJS, diff gate", ["Type-safe Mock Pattern", "tsconfig 3File Structure", "NestJS", "diff coverage"], TS_FLOOR]], {label_prefix: "Language guide", subdir: "langs"});
check_ref_contracts(check, ROOT, [["antipatterns.md", "three flakiness axes, order dependence, permitted mocks by level", ["Axis 1 — clock", "Axis 2 — randomness", "Axis 3 — network and shared resources", "go test -shuffle=on", "/generate-test --level", "integration in name only", "### Rules for every new test", "Simulate the failure you mean."], ANTI_FLOOR], ["test-budget.md", "design checklist, budget check, CI job, structural guard, test review", ["# Test budget", "## Design checklist", "## Budget check for new and changed tests", "## Enforce it in CI", "## A guard for structural fixes", "## Review a test someone else wrote", "--fail-on-waiting", "never by raising the budget"], TEST_BUDGET_FLOOR], ["test-portfolio.md", "test sizes, suite shape, oracle strength, adjacent techniques", ["# Test portfolio", "## Size by construction", "## Shape of the suite", "## Judge tests by oracle strength", "## Adjacent techniques", "## Keep the suite healthy over time", "diff-based mutation testing"], TEST_PORTFOLIO_FLOOR]]);
check("Always read: cites the test portfolio reference", contains(skill, "`references/test-portfolio.md`"));
check("Provenance: NOTICE records the adapted MIT source, commit, and license text", (()=>{let n='';try{n=readFileSync(join(ROOT, 'NOTICE'),'utf8');}catch{}return n.includes('hunkim/ai-is-fast-your-tests-are-slow')&&n.includes('9b076d08ffb5e6dd1e652b67984d533a6251810b')&&n.includes('Permission is hereby granted, free of charge');})());
check("Always read: cites the test budget reference", contains(skill, "`references/test-budget.md`"));
(META=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
(live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), META)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: PER_FILE, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: BODY_MIN, live_ran: live_ran});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/test_gates.js": GATE_MIN}, live_ran: live_ran});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, TOTAL);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((passed === length(results))) ? 0 : 1);
}
process.exitCode=main();
