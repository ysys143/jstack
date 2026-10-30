/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const SLICE_SHAPE_FLOOR=3520;
const SKILL_FLOOR=59;
const SLICE_SHAPE_CONTRACTS=7;
const BRAINSTORMING_CONTRACTS=16;
const CONSENSUS_CONTRACTS=16;
const SCRIPT_FLOOR=43;
const TOTAL=162;
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}

function main():any{
let META:any,OK_CONTRACT:any,_:any,_code_grades:any,_doc_grades:any,_fb:any,_fbv:any,_got:any,_lint:any,_m:any,_m2:any,_m3:any,_name:any,_rc_rows:any,_slice:any,_unexecutable_rows:any,_vals:any,baked:any,embed:any,f:any,fm:any,g:any,gone:any,good:any,i:any,label:any,lint_py:any,live_ran:any,missing:any,n:any,named:any,needle:any,ok:any,outside:any,p:any,passed:any,phases:any,r:any,rc_unexecutable:any,rendered:any,sec:any,skill:any,skills_dir:any,surface:any,t:any,t2:any,td:any,template:any,templates:any,text:any,v1:any,what:any,x:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
check("Criteria: requires verifiable statements", ((contains(skill, "In verifiable sentences"))));
check("Criteria: rejects works well as an acceptance criterion", ((contains(skill, "\"Works well\" is not a criterion"))));
check("Criteria: pairs bad and good examples", ((value:any)=>truth(value)?((contains(skill, "401"))):value)(((contains(skill, "p95 under 200 ms")))));
check("Criteria: explains why this gives the document value", ((value:any)=>truth(value)?value:((contains(skill, "worth writing"))))(((contains(skill, "is what makes this document\nworth writing")))));
check("Stop: requires stopping when about to start coding", ((contains(skill, "Stop when the urge is to start coding"))));
check("Stop: distinguishes seeming clear from being clear", ((value:any)=>truth(value)?value:((contains(skill, "that is clear"))))(((contains(skill, "looks clear and one\nthat is clear")))));
check("Stop: prohibits proceeding with ambiguity", ((contains(skill, "Do not proceed while ambiguous"))));
check("Stop: an answer that cannot be obtained is reported as a blocker, not filled with an assumption", (()=>{const flat=skill.replace(/\s+/g," ");return flat.includes("report it as a blocker: name the question, what it blocks and who can answer it")&&flat.includes("Do not fill the gap with an assumption and move on")&&flat.includes("A small reversible choice that nothing else depends on is the one exception");})());
check("Stop: requires returning when a question cannot be answered", ((value:any)=>truth(value)?((contains(skill, "bakes that assumption into the code"))):value)(((contains(skill, "that you cannot answer")))));
{
const flat=skill.replace(/\s+/g," "),migration=read(join(ROOT,"references","migration-verification.md")).replace(/\s+/g," ");
check("Probe: a question a run can answer is settled by a throwaway probe, and only product or preference calls are asked", flat.includes("**Run a question that a run can answer.**")&&flat.includes("run the smallest throwaway probe in a scratch directory and report the result")&&flat.includes("Ask only about product or preference calls no run can settle")&&flat.includes("installs nothing, touches no shared state, and its code is never kept"));
check("Gate: reversible local steps proceed and are reported; only hard-to-undo or outward steps stop", flat.includes("**What stops and what does not.**")&&flat.includes("hard to undo or leaves this machine (push, PR, publish, delete, install, paid API, long-running service)")&&flat.includes("report what you did and what is still open in the same reply"));
check("Shape: non-trivial work sketches types and signatures from the caller's usage before code, and redesigns instead of bolting on", flat.includes("### Sketch the shape before the code")&&flat.includes("Write the caller's usage first, then derive types, signatures and module boundaries")&&flat.includes("redesign as if it had been there from the start")&&flat.includes("the sketch is wrong: redraw it instead of patching"));
check("Migration: a migration plan declares allowed breakage and per-phase checks, with no compatibility copies", flat.includes("declares where breakage is allowed and what each phase must pass, and does not plan compatibility copies")&&["## Plan the breakage, not a bridge","**Where breakage is allowed.**","**What each phase must still pass.**","**Full verification at the last phase.**","**A commit is the rollback.**","**A forced bridge names its removal.**","A bridge with no removal step is not accepted"].every(needle=>migration.includes(needle)));
}
(phases=findall("(?m)^## Phase (\\d)", skill));
check("Order: three phases occur in order", (isDeepStrictEqual(phases,["1", "2", "3"])), (pyStr(phases)));
for (let [n, what] of [["1", "grill"], ["2", "spec"], ["3", "zoom-out"]]) {
check(("Order: Phase " + pyStr(n) + " is " + pyStr(what)), ((search(("(?m)^## Phase " + pyStr(n) + "[^\\n]*" + pyStr(what)), skill) !== null)));
}
check("Order: explains why the three phases are combined", ((value:any)=>truth(value)?((contains(skill, "three always-on descriptions"))):value)(((contains(skill, "form one ordered task")))));
for (let sec of ["User stories", "Acceptance criteria", "Edge cases", "Constraints"]) {
check(("Spec: includes the " + pyStr(sec) + " section"), ((contains(skill, sec))));
}
check("Zoom-out: numbers all three axes", (Array.from([1, 2, 3]).map((i: any) => (((contains(skill, (pyStr(i) + ". **"))))))).every((value:any)=>truth(value)));
check("Zoom-out: requires simplification of excessive complexity and explains why", ((value:any)=>truth(value)?((contains(skill, "costs less than"))):value)(((contains(skill, "If it is more than needed, cut it")))));
(skills_dir=dirname(ROOT));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(skills_dir, n))))).map((n: any) => (n)));
check("Boundary: redirection target population is nonempty", (compare(length(named),3,">=")), (pyStr(sorted(named))));
check("Boundary: all redirection targets exist", !truth(missing), ("missing " + pyStr(missing)));
check("Limits: identifies answers as belonging to the user", ((contains(skill, "The answers are the user's"))));
check("Limits: does not verify whether the spec is correct", ((contains(skill, "does not check whether the spec is correct"))));
check("Language: description names the Korean activation intent", ["계획", "요구사항"].every(term => fm.includes(term)));
check("Language: description also includes English triggers", ((value:any)=>truth(value)?((contains(fm, "requirements"))):value)(((contains(fm, "spec")))));
check("References: SKILL.md names the slice-shape reference path", ((contains(skill, "references/slice-shape.md"))));
{
const migrationTrigger="For an uplift, transform, or reimagine of code (a version upgrade on the same\nstack, a stack replacement, or a rebuild that changes behavior), read\n[the migration verification reference](references/migration-verification.md)\nbefore writing Decisions and Acceptance criteria. A schema or data migration\nalone is not one.";
const phase2At=skill.indexOf("## Phase 2: write the spec"),migrationAt=skill.indexOf(migrationTrigger),tableAt=skill.indexOf("| Section | Contents |");
check("Migration: trigger opens Phase 2 before the spec sections",phase2At>=0&&migrationAt>phase2At&&tableAt>migrationAt);
}
check("References: SKILL.md names the contract_lint path", ((contains(skill, "scripts/contract_lint.js"))));
check("References: SKILL.md fixes the contract file path", ((contains(skill, ".jstack/tasks/<task-id>/contract.yaml"))));
check("References: SKILL.md distinguishes rc 2 from rc 0", ((value:any)=>truth(value)?value:((contains(skill, "exits 2 — not 0 —"))))(((contains(skill, "It\nexits 2 — not 0 —")))));
check("References: SKILL.md requires verify to run the linter first", ((value:any)=>truth(value)?((contains(skill, "before reading earlier task claims"))):value)(((contains(skill, "verify command\nruns this linter before")))));
{
const trigger="one state root; before initialization, read [the pre-mortem reference](references/pre-mortem.md)\nif any of these apply: the work is expensive to reverse, a launch or migration is\nimminent, or there is evidence that the plan may be optimistic.";
const initStep="node \"${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js\" init <task-id> contract.yaml";
const triggerAt=skill.indexOf(trigger),initAt=skill.indexOf(initStep);
const between=triggerAt>=0&&initAt>triggerAt?strip(skill.slice(triggerAt+trigger.length,initAt)):"";
check("Pre-mortem: trigger lists every condition immediately before initialization",triggerAt>=0&&initAt>triggerAt&&between==="```bash");
}
check("v2: specifies one task-state root and immutable contract path", ((value:any)=>truth(value)?((contains(skill, "immutable copy"))):value)(((contains(skill, ".jstack/tasks/<task-id>/contract.yaml")))));
check("v2: links requirements to IDs, user behavior, and related files", (Array.from(["stable ID", "user-observable behavior", "files that implement it"]).map((x: any) => (((contains(skill, x)))))).every((value:any)=>truth(value)));
check("v2: positive and RED commands require expected exit codes", ((value:any)=>truth(value)?((contains(skill, "RED command with its expected exit code"))):value)(((contains(skill, "positive command with its expected exit code")))));
check("v2: RED uses the temporary related-file copy placeholder", ((value:any)=>truth(value)?((contains(skill, "list every fixture, configuration file, and dependency"))):value)(((contains(skill, "temporary\ncopy through `{RED_ROOT}`")))));
check("v2: selects only review types needed by the task", (Array.from(["`cold-read`", "`사실`", "`평가독립성`", "`SSOT`", "`이식성`"]).map((x: any) => (((contains(skill, x)))))).every((value:any)=>truth(value)));
check("v2: skipped reviews require a reason", ((contains(skill, "Mark an inapplicable review `생략` and\nstate why"))));
check("v2: simple tasks skip delegation procedures but retain verification", ((value:any)=>truth(value)?((contains(skill, "still gets fresh verification"))):value)(((contains(skill, "may set `위임: 불필요`")))));
check("References: SKILL.md includes the discriminating question in its body", ((contains(skill, "Ask what runs at the end of step one"))));
(lint_py=join(ROOT, "scripts", "contract_lint.js"));
check("Script: contract_lint.js exists", isfile(lint_py));
function lint(...args:any[]):any{
return subprocessRun([({executable:process.execPath}).executable, lint_py, ...args],{capture_output:true,text:true,cwd:ROOT});
}
(surface=join(dirname(ROOT), "author", "references", "package-surface.yaml"));
check("Script: package-surface.yaml is the default judge", isfile(surface), surface);
(OK_CONTRACT="계약버전: 1\n발동: 사용자\n선행:\n  - 조건: gws-jstack auth is oauth2\n    유형: 동적\n    확인: gws-jstack auth status\n    실패시: 불가역\n산출:\n  - 경로: src/api/login.py\n    형식: py\n검증:\n  - 등급: 기계\n    명령: pytest tests/\n    RED: reversing one login branch fails the newly added test\n  - 등급: 인간\n    명령: 없음\n    승인기록: .jstack/plan/login/approval.md\n후행: [verify]\n출처: skills/plan/references/slice-shape.md\n");
{const td=temporaryDirectory();try{function fixture(name:any,text:any):any{
let f:any,p:any;
(p=join(td, name));
{const f=fileHandle(p,"w");f.write(text);}
return p;
}
(templates=findall("(?s)"+"```yaml\\n(.*?)\\n```",skill));
check("v2 example: exactly one executable YAML template exists", (isDeepStrictEqual(length(templates),1)), (pyStr(length(templates)) + " templates"));
(template=fixture("template-v2.yaml", (truth(templates) ? at(templates, 0) : "")));
(rendered=lint(template));
check("v2 example: documented one-requirement, no-delegation template returns linter rc 0", (isDeepStrictEqual(rendered.returncode,0)), slice(at(((value:any)=>truth(value)?value:[("rc=" + pyStr(rendered.returncode))])(lines(strip(rendered.stderr))), -(1)), 0, 120));
(good=fixture("ok.yaml", OK_CONTRACT));
(r=lint(good));
check("Behavior: schema-conforming contract returns rc 0", (isDeepStrictEqual(r.returncode,0)), slice(at(((value:any)=>truth(value)?value:[("rc=" + pyStr(r.returncode))])(lines(strip(r.stderr))), -(1)), 0, 120));
check("Behavior: pass output reports numeric zero violations and zero external paths", ((value:any)=>truth(value)?((contains(r.stdout, "package-external path references 0"))):value)(((contains(r.stdout, "violations: 0")))), slice(at(((value:any)=>truth(value)?value:["(no output)"])(lines(strip(r.stdout))), -(1)), 0, 100));
for (let [i, [label, text, needle]] of enumerate([["missing schema version", replace(OK_CONTRACT, "계약버전: 1\n", ""), "`계약버전:`"], ["invalid trigger value", replace(OK_CONTRACT, "발동: 사용자", "발동: 자동"), "`발동:` has an invalid value"], ["invalid grade value", replace(OK_CONTRACT, "등급: 인간", "등급: 반자동"), "`검증[1].등급` has an invalid value"], ["missing RED for machine grade", replace(OK_CONTRACT, "    RED: reversing one login branch fails the newly added test\n", ""), "RED"], ["missing approval record for human grade", replace(OK_CONTRACT, "    승인기록: .jstack/plan/login/approval.md\n", ""), "승인기록"], ["missing probe for dynamic prerequisite", replace(OK_CONTRACT, "    확인: gws-jstack auth status\n", ""), "확인"], ["missing output format", replace(OK_CONTRACT, "    형식: py\n", ""), "형식"]])) {
(r=lint(fixture(("bad" + pyStr(i) + ".yaml"), text)));
check(("Behavior: " + pyStr(label) + " returns rc 1"), (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
check(("Behavior: " + pyStr(label) + " identifies the violated requirement"), ((contains(r.stderr, needle))), slice(at(((value:any)=>truth(value)?value:["(no stderr)"])(lines(strip(r.stderr))), -(1)), 0, 100));
}
(baked=fixture("table.yaml", replace(OK_CONTRACT, "    명령: pytest tests/\n", "    명령: |\n      | marp | marp -o out.pdf |\n      | office | officecli build |\n")));
(r=lint(baked));
check("Behavior: an unbaked conditional table returns rc 1", (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
check("Behavior: identifies remaining table syntax", ((contains(r.stderr, "table syntax"))), slice(at(((value:any)=>truth(value)?value:["(no stderr)"])(lines(strip(r.stderr))), 0), 0, 100));
(outside=fixture("outside.yaml", replace(OK_CONTRACT, "출처: skills/plan/references/slice-shape.md", "출처: ../../other-plugin/skills/x/SKILL.md")));
(r=lint(outside));
check("Behavior: a package-external path returns rc 1", (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
check("Behavior: reports a numeric package-external path count", ((contains(r.stdout, "package-external path references 1"))), slice(at(((value:any)=>truth(value)?value:["(no output)"])(lines(strip(r.stdout))), -(1)), 0, 100));
check("Behavior: identifies the value pointing outside", ((contains(r.stderr, "other-plugin"))), slice(at(((value:any)=>truth(value)?value:["(no stderr)"])(lines(strip(r.stderr))), 0), 0, 100));
(embed=fixture("embed.yaml", replace(OK_CONTRACT, "출처: skills/plan/references/slice-shape.md", "출처: docs/../../../etc/passwd")));
(r=lint(embed));
check("Behavior: an internal ../ segment also escapes the package", (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
check("Behavior: counts an internal ../ segment as an external path", ((contains(r.stdout, "package-external path references 1"))), slice(at(((value:any)=>truth(value)?value:["(no output)"])(lines(strip(r.stdout))), -(1)), 0, 100));
(t2=fixture("table2.yaml", replace(OK_CONTRACT, "    명령: pytest tests/\n", "    명령: |\n      | marp |\n      | office |\n")));
(r=lint(t2));
check("Behavior: a two-cell conditional table also returns rc 1", (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
check("Behavior: identifies the row of a two-cell table (source-line check survives)", ((contains(r.stderr, "contains table syntax"))), slice(at(((value:any)=>truth(value)?value:["(no stderr)"])(lines(strip(r.stderr))), -(1)), 0, 100));
(r=lint("--surface", join(td, "no-surface.yaml"), outside));
check("Behavior: fallback judge still rejects external paths", (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
check("Behavior: fallback does not cover everything (count remains nonzero)", ((contains(r.stdout, "package-external path references 1"))), slice(at(((value:any)=>truth(value)?value:["(no output)"])(lines(strip(r.stdout))), -(1)), 0, 100));
(gone=join(td, "does-not-exist.yaml"));
(v1=fixture("batch-v1.yaml", replace(OK_CONTRACT, "발동: 사용자", "발동: 자동")));
(r=lint(gone, v1));
check("Behavior: batch rc 2 dominates rc 1 with the unexecutable contract first", (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
(r=lint(v1, gone));
check("Behavior: batch rc 2 dominates rc 1 with the violating contract first", (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
(r=lint(good, v1));
check("Behavior: batch rc 1 dominates rc 0", (isDeepStrictEqual(r.returncode,1)), ("rc=" + pyStr(r.returncode)));
(r=lint(join(td, "does-not-exist.yaml")));
(rc_unexecutable=r.returncode);
check("Behavior: missing contract file returns rc 2 rather than rc 0", (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
(r=lint(fixture("broken.yaml", "a: [1,\n")));
check("Behavior: YAML parse failure returns rc 2", (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
(r=lint(fixture("scalar.yaml", "just one sentence\n")));
check("Behavior: a non-mapping root returns rc 2", (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
(r=lint());
check("Behavior: zero contract arguments return rc 2 (zero checks cannot pass)", (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
(r=lint("--surface", join(td, "no-surface.yaml"), good));
check("Behavior: missing judge reports fallback use", ((contains(r.stderr, "fallback"))), slice(at(((value:any)=>truth(value)?value:["(no stderr)"])(lines(strip(r.stderr))), 0), 0, 100));
check("Behavior: fallback completes with rc 0", (isDeepStrictEqual(r.returncode,0)), ("rc=" + pyStr(r.returncode)));}finally{removeTree(td);}}
check_ref_contracts(check, ROOT, [["slice-shape.md", "horizontal-layer versus vertical-slice discrimination (inherited from zoom-out)", ["A horizontal layer finishes a level; a vertical slice finishes a behaviour.", "The horizontal plan is not caught by looking at it, because it looks like order.", "Ask what runs at the end of step one.", "Recutting is cheaper than it looks, and it gets more expensive every slice."], SLICE_SHAPE_FLOOR], ["security-scope.md", "security request scope, threat model, optional task link", ["# Security-task scope contract", "schemaVersion: 1", "assets, entry points, attacker's existing privileges", "보안검증:", "Ordinary v1 and v2 tasks follow the existing"], 1903], ["pre-mortem.md", "plan-specific pre-mortem procedure and v2 binding rules", ["## When to omit", "no residual path the gates miss", "## Procedure", "past tense", "three to five", "version 2 `검증` item", "`요구ID`", "`명령`", "`반증`", "`{RED_ROOT}`", "do not invent a command", "named owner", "Acceptance criteria", "If the plan did not change, the pre-mortem is incomplete.", "The interview question \"What if it fails\""], 1900], ["migration-verification.md", "migration type, evidence by type, and contract binding", ["before writing the spec's Decisions and Acceptance", "A schema or data migration alone is not one.", "## Name the type before the requirements", "**Uplift**", "**Transform**", "**Reimagine**", "**Decisions**", "**Assumptions**", "revisit when: <condition>", "do not start a second document", "## Inventory current behavior", "## Pick evidence by type", "round-trip", "`반증`", "`{RED_ROOT}`", "`cold-read`", "that requirement stays open", "a separate task with its own", "Without a contract, put the same evidence", "`인간검토: 필요`", "Pilot before scaling", "[pre-mortem](pre-mortem.md)"], 2600], ["brainstorming.md", "repository first shaping and revision contract", ["# Brainstorming — repository-grounded design shaping"], 6929], ["consensus-plan.md", "independent bounded plan revision recipe", ["# Consensus plan — independent review and author revision"], 8001]]);
const notice=read(join(ROOT,"NOTICE"));
check("Provenance: NOTICE records the pinned source and MIT license",contains(notice,"tjboudreaux/cc-thinking-skills")&&contains(notice,"7b8fece345dfaa11773be7152ccd194589cb5437")&&contains(notice,"skills/thinking-pre-mortem/SKILL.md")&&contains(notice,"Permission is hereby granted")&&contains(notice,"upstream unmeasured; jstack unmeasured"));
{
const flat=(text:string):string=>text.replace(/\s+/g," ");
const holds=(text:string,needles:string[]):boolean=>{const body=flat(text);return needles.every(needle=>body.includes(needle));};
const brainstorm=read(join(ROOT,"references","brainstorming.md")),consensus=read(join(ROOT,"references","consensus-plan.md"));
check("Brainstorm: repository facts are read before questions are asked",holds(brainstorm,["Before detailed questions, inspect the existing flow, callers, tests","Familiarity with an app category is not evidence","Resolve repository questions by reading"]));
check("Brainstorm: spike, bounded or architectural depth is chosen from evidence and stated",holds(brainstorm,["State the selected depth and the concrete reason","| Spike |","| Bounded |","| Architectural |","| No shaping needed |","Reassess depth when new evidence changes boundaries"]));
check("Brainstorm: bounded work needs no full spec",holds(brainstorm,["Short design in conversation, affected files and verification; no mandatory spec or implementation-plan file"]));
check("Brainstorm: executing an accepted spec is a non-trigger",holds(brainstorm,["Use when brainstorming or design shaping is explicitly selected, by the user's request or by a workflow the user started","Do not interpose on explanation, read-only review, diagnosis, ordinary planning or execution of an already accepted specification","A clear accepted revision already determines the requested execution"])&&holds(skill,["Executing an already accepted spec is a non-trigger for both"]));
check("Brainstorm: alternatives are substantive and no stack is chosen by default",holds(brainstorm,["substantively different","Renamed versions of the same design are not alternatives","propose a minimal default with its reason","no automatic React, Next or shadcn choice"]));
check("Brainstorm: a rejected design is revised and presented again",holds(brainstorm,["If rejected, record the actual objection","present the revised design again","No response, elapsed time, a tool-success message or another agent's claim is acceptance"]));
check("Brainstorm: agreement is bound to a scope and revision",holds(brainstorm,["valid acceptance binds the scope and revision","same scope and revision","Record its source rather than asking again","leaves agreement unverified"]));
check("Brainstorm: a design-only call returns its result and starts nothing",holds(brainstorm,["A standalone or external design-only call ends with that result","does not start implementation, write task state, commit","require no jstack task registration"]));
check("Brainstorm: a resume restores objections and uncertain effects",holds(brainstorm,["restore objections before reusing acceptance","uncertain effect","check revision identity"]));
check("Brainstorm: open decision dependencies go to requirements-interview",holds(brainstorm,["the `requirements-interview` skill owns unresolved decision dependencies"])&&!/grill/i.test(brainstorm));
check("Brainstorm: SKILL.md routes an explicit request to the full core",holds(skill,["An explicit brainstorming or design-shaping request selects [the shaping core](references/brainstorming.md)","chooses spike, bounded or architectural depth","Bounded work needs no full spec"]));
check("Consensus: alternatives, drivers and criteria are fixed before review",holds(consensus,["three to five design principles","at least two substantive viable alternatives","three concrete failure scenarios","Freeze the criteria and context supplied to assessors"]));
check("Consensus: one fixed revision with a digest is reviewed",holds(consensus,["one immutable plan snapshot with a revision and SHA-256 digest","Review one unchanged revision","Check the plan/context digest before and after each review"]));
check("Consensus: assessors review independently without each other's output",holds(consensus,["without any other assessor's response","never the first response","shared files, inherited chat or imported instructions"]));
check("Consensus: only the author synthesizes and the whole revision is reviewed again",holds(consensus,["The planner alone collects and synthesizes both completed results","revises the complete plan","Both assessors review that entire revised plan","Do not mix an older approval with a newer plan"]));
check("Consensus: the re-review cap is finite and declared at selection",holds(consensus,["At selection fix finite limits: at most five total review rounds","at most two invalid rounds","No restart, correction or resume resets these counters"]));
check("Consensus: an invalid round cannot certify consensus",holds(consensus,["invalidates the whole round","discard their verdicts","retry only within the original remaining limits","cannot certify consensus"]));
check("Consensus: consensus never approves execution",holds(consensus,["cannot authorize implementation, commits, publication or execution delegation","Review consensus is not human acceptance or permission to execute","this planning recipe stops and does not implement it itself"]));
check("Consensus: an unavailable assessor returns a status instead of a roleplay",holds(consensus,["return that status; never relabel one author's roleplay as independent consensus","return unavailable with the best current proposal","do not narrate or simulate completed reviews","Missing reviews are unavailable/partial, not approval"]));
check("Consensus: a stop returns the best plan and its dissent",holds(consensus,["return the best plan plus unresolved disagreement and exact pending/unavailable/cancelled status","Do not force consensus or continue endlessly"]));
check("Consensus: it shares second-opinion's reviewer separation and adds the revision loop",holds(consensus,["is a `second-opinion` request","each assessor sees the same artifact and no other assessor's output","its consensus is evidence, not permission to execute"]));
check("Consensus: SKILL.md routes an explicit request to the full recipe",holds(skill,["An explicit `consensus-plan` or `plan --consensus` request selects [the consensus recipe](references/consensus-plan.md)","a finite re-review cap declared up front","never automatic execution"]));
check("Routing: only an explicit request enters either procedure and ordinary planning keeps its three phases",holds(skill,["Only an explicit request from the user, or an explicit selection by a workflow the user started, selects one of these reference procedures","An ordinary plan request keeps the three phases below, in order, and reads neither reference","a reference never replaces the interview, the spec or the zoom-out of ordinary planning","offer shaping or consensus once per plan; do not enter either without that explicit selection"])&&holds(brainstorm,["jstack selects this core only on an explicit request; upstream's use before any creative work is not imported, and ordinary planning only offers it"])&&holds(consensus,["when `consensus-plan` or jstack `plan --consensus` is explicitly selected, by the user's request or by a workflow the user started"])&&!/material choices still open, selects/.test(flat(skill))&&!holds(brainstorm,["when design choices remain, or an explicit"]));
check("Recipes: neither reference depends on a jstack aggregate or a second task state",!/aggregate|second task state/i.test(brainstorm+consensus));
check("Recipes: the description is not widened by the shaping and consensus routes",!/brainstorm|consensus|design-shaping/i.test(fm));
const notice2=read(join(ROOT,"NOTICE")),brainstormLicense=read(join(ROOT,"references","brainstorming-LICENSE.txt")),consensusLicense=read(join(ROOT,"references","consensus-LICENSE.txt"));
check("Provenance: NOTICE records the pinned brainstorming source and its retained MIT notice",holds(notice2,["obra/superpowers","b36e0829c6d0140e93cfef2ca599b1b07d4a7797","jstack selects it only on an explicit request, where upstream is used before any creative work","references/brainstorming-LICENSE.txt"])&&holds(brainstormLicense,["MIT License","Copyright (c) 2025 Jesse Vincent","Permission is hereby granted"])&&holds(brainstorm,["(brainstorming-LICENSE.txt)","b36e0829c6d0140e93cfef2ca599b1b07d4a7797"]));
check("Provenance: NOTICE records the pinned consensus source and its retained MIT notice",holds(notice2,["Yeachan-Heo/oh-my-claudecode","5281b19e0d64f8e6dc6767f2130299a88af2dc71","references/consensus-LICENSE.txt"])&&holds(consensusLicense,["MIT License","Copyright (c) 2025 Yeachan Heo","Permission is hereby granted"])&&holds(consensus,["(consensus-LICENSE.txt)","5281b19e0d64f8e6dc6767f2130299a88af2dc71"]));
}
(_lint=read(join(ROOT, "scripts", "contract_lint.js")));
for (let [_name, _vals] of [["VALID_TRIGGERS", ["모델", "사용자"]], ["VALID_GRADES", ["기계", "인간", "불가", "미상"]], ["VALID_KINDS", ["정적", "동적"]]]) {
(_m=search((_name + "\\s*=\\s*\\[([^\\]]*)\\]"), _lint));
(_got=(truth(_m) ? Array.from(findall("['\"]([^'\"]+)['\"]", group(_m, 1))) : []));
check(("Linter: " + pyStr(_name) + " equals the canonical value list"), (isDeepStrictEqual(_got,_vals)), (pyStr(_got)));
}
(_m=search("`((?:기계|인간|불가|미상|[가-힣]+)(?:\\s*\\|\\s*[가-힣]+)+)`", skill));
(_doc_grades=(truth(_m) ? Array.from(Array.from(split(group(_m, 1), "|")).map((g: any) => (strip(g)))) : []));
(_m2=search("VALID_GRADES\\s*=\\s*\\[([^\\]]*)\\]", _lint));
(_code_grades=(truth(_m2) ? Array.from(findall("['\"]([^'\"]+)['\"]", group(_m2, 1))) : []));
check("Cross-check: SKILL.md grade list exactly equals code constants", ((value:any)=>truth(value)?(isDeepStrictEqual(_doc_grades,_code_grades)):value)(truth(_doc_grades)), ("document " + pyStr(_doc_grades) + " / code " + pyStr(_code_grades)));
check("Linter: grade list matches SKILL.md prose", (Array.from(["기계", "인간", "불가", "미상"]).map((g: any) => (((contains(skill, g)))))).every((value:any)=>truth(value)));
(_rc_rows=findall("(?m)^\\| (\\d) \\| ([^|]+)\\|", _lint));
check("Cross-check: linter docstring declares rc 0, 1, and 2 in order", (isDeepStrictEqual(Array.from(_rc_rows).map(([n, _]: any) => (n)),["0", "1", "2"])), (pyStr(Array.from(_rc_rows).map(([n, _]: any) => (n)))));
(_unexecutable_rows=Array.from(_rc_rows).filter(([n, t]: any) => truth(((contains(t, "Checking could not start"))))).map(([n, t]: any) => (n)));
check("Cross-check: docstring's unable-to-run code equals observed rc", (isDeepStrictEqual(_unexecutable_rows,[pyStr(rc_unexecutable)])), ("docstring " + pyStr(_unexecutable_rows) + " / observed rc=" + pyStr(rc_unexecutable)));
(_m3=search("exits (\\d) — not (\\d) —", skill));
check("Cross-check: SKILL.md's unable-to-run code equals observed rc", ((value:any)=>truth(value)?((value:any)=>truth(value)?(!isDeepStrictEqual(Number(group(_m3, 2)),rc_unexecutable)):value)((isDeepStrictEqual(Number(group(_m3, 1)),rc_unexecutable))):value)(((_m3 !== null))), ("SKILL.md " + pyStr((truth(_m3) ? _m3.slice(1) : null)) + " / observed rc=" + pyStr(rc_unexecutable)));
check("Linter: --quiet changes output only, not exit codes", ((value:any)=>truth(value)?((!contains(_lint, "return 0  # quiet"))):value)(((!contains(_lint, "if args.quiet:\n        return 0")))));
check("Linter: batches inspect every supplied contract rather than only the first", ((value:any)=>truth(value)?((!contains(_lint, "contracts.slice(0, 1)"))):value)(((contains(_lint, "for (const file of contracts)")))));
(_fb=search("FALLBACK_SURFACE_PATTERNS\\s*=\\s*\\[([^\\]]*)\\]", _lint));
(_fbv=(truth(_fb) ? findall("['\"]([^'\"]+)['\"]", group(_fb, 1)) : []));
check("Linter: fallback surface cannot match everything and nullify judgment", ((value:any)=>truth(value)?((!contains(_fbv, "**"))):value)(truth(_fbv)), pyStr(_fbv));
(_slice=read(join(ROOT, "references", "slice-shape.md")));
check("Slice: comparison headers run horizontal then vertical", ((search("\\|\\s*\\|\\s*Horizontal layer\\s*\\|\\s*Vertical slice\\s*\\|", _slice) !== null)));
check("Slice: anti-pattern uses [X] and recommended example uses [O]", ((value:any)=>truth(value)?((contains(_slice, "[O] Slice 1:"))):value)(((contains(_slice, "[X] Phase 1: define every model")))));
check("Slice: recutting is triggered by finishing a level", ((contains(_slice, "Step one finishes a level rather than a behaviour"))));
check("Slice: discriminating conclusion contains no inserted negation", ((value:any)=>truth(value)?((!contains(_slice, "not horizontal no matter how"))):value)(((contains(_slice, "horizontal no matter how it is labelled.")))));
check_skill_body(check, ROOT, {needles: ["In verifiable sentences", "Do not proceed while ambiguous", "Stop when the urge is to start coding", "If it is more than needed, cut it"], floor: 4514});
(META=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
(live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), META)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": SKILL_FLOOR, "references/slice-shape.md": SLICE_SHAPE_CONTRACTS, "references/security-scope.md": 3, "references/pre-mortem.md": 3, "references/migration-verification.md": 4, "references/brainstorming.md": BRAINSTORMING_CONTRACTS, "references/consensus-plan.md": CONSENSUS_CONTRACTS, "NOTICE": 3, "scripts/contract_lint.js": SCRIPT_FLOOR}, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: SKILL_FLOOR, live_ran: live_ran});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/contract_lint.js": SCRIPT_FLOOR}, live_ran: live_ran});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, (TOTAL + 3));
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
