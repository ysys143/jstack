/** Owning behavior and protocol contracts, with measured deletion controls. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync,symlinkSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function scriptInputDigest(dirs:string[]):string{const hash=createHash('sha256').update(process.version).update('\0').update(process.execPath);
  const visit=(base:string,dir:string):void=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const path=join(dir,entry.name);
    if(entry.isDirectory()){if(!['node_modules','__pycache__','refs'].includes(entry.name))visit(base,path);}
    else if(entry.isFile()){hash.update('\0'+relative(base,path)+'\0');hash.update(readFileSync(path));}}};
  for(const dir of dirs){hash.update('\0dir:'+relative(dirname(SKILLS),dir));if(existsSync(dir))visit(dir,dir);}
  return hash.digest('hex');}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const PREFLIGHT=join(ROOT, "scripts", "preflight.js");
const PACKAGE_CHECK=join(ROOT, "scripts", "package_check.js");
const RED_PROBE=join(ROOT, "scripts", "red_probe.js");
const PACKAGE_IDENTITY=join(ROOT, "scripts", "package_identity.js");
const WORKFLOW=join(ROOT, "scripts", "workflow.js");
const WORKFLOW_TEST=join(HERE, "workflow-migration.test.js");
const SKILL_FLOOR=7812;
const CLAIM_FLOOR=4482;
const DIGEST_FLOOR=6154;
const MERGE_FLOOR=2393;
const SELF_CHECK_FLOOR=2330;
const SKILL_MIN=64;
const CLAIM_MIN=4;
const DIGEST_MIN=4;
const MERGE_MIN=4;
const SELF_CHECK_MIN=5;
const PREFLIGHT_FLOOR=23;
const PKGCHECK_FLOOR=9;
const REDPROBE_FLOOR=12;
const PACKAGE_IDENTITY_FLOOR=48;
const PACKAGE_IDENTITY_COVERAGE_FLOOR=48;
const WORKFLOW_FLOOR=3;
const TEST_WAITS_FLOOR=7595,TEST_PARALLELISM_FLOOR=7878,TEST_SELECTION_FLOOR=8029,FLAKY_TESTS_FLOOR=5266,TEST_EVIDENCE_FLOOR=22917,TEST_PROFILE_FLOOR=9,TEST_SMELLS_FLOOR=2;
const INTERACTIVE_CLI_FLOOR=6302;
const CI_DIAGNOSIS_FLOOR=3047;
const TOTAL=230;
const CLAIM_ANCHORS=["# Claim labels — what the evidence covers", "| Verification grade | Who settles it |", "## The four labels", "| `verified` | The evidence covers the whole claim.", "| `unsupported` | Only the preconditions are supported;", "## The four rules", "**1. `verified` never exceeds the review input scope or the evidence timestamp.**", "**2. Filename correspondence is not evidence.**", "**3. Preconditions only means `unsupported` or `insufficient-coverage`", "**4. Scope-limited `verified` is allowed.**", "## Decision tree", "1. Did any evidence run at all", "6. Otherwise -> verified", "## Worked examples", "## Writing the label in a report", "## What this does not do"];
const DIGEST_ANCHORS=["# Digest contract", "## Three digests, never one", "**Do not merge these into one.**", "## Canonicalization v2", "**1. Codepoint order.**", "**2. NUL framing.**", "**3. mtime and mode are excluded.**", "**4. `metadata.version` becomes `@VERSION@`.**", "## Reporting a digest", "## Failure modes seen", "| Cache not invalidated after a real behaviour change | One digest doing three jobs |"];
const MERGE_ANCHORS=["# Merge worktree", "## Current context", "## Instructions", "### Phase 1: Validation", "**Verify worktree**", "**Clean working tree**", "### Phase 2: Research", "### Phase 3: Target branch preparation", "### Phase 4: Squash merge", "**stop and report**", "### Phase 5: Craft commit message and commit", "Trailers are not written here", "### Phase 6: Verification", "## Important notes", "Never skip pre-commit hooks"];
const SELF_CHECK_ANCHORS=["# Run Only Reviews Required by the Work", "| Review | When required | What the reviewer checks |", "| factual | External facts, figures, or quotations determine the result.", "| evaluation independence | A model evaluation, benchmark, or validator pass supports the claim.", "| SSOT | The same fact, rule, or number is maintained in multiple places.", "| portability | The result claims support across harnesses, paths, or installations.", "| cold-read | Another person will use an important explanation, plan, or deliverable.", "node scripts/workflow.js record-review TASK REQUIREMENT cold-read", "`record-review` binds the contract, reviewed files, and raw result hashes."];
const SKILL_NEEDLES=["No completion claim without fresh evidence", "A pipe hides the exit code", "rc=$?", "Do not pretend to measure the right column", "A check that does not exist is not a passing check", "Diff coverage is a floor, not a proof", "| \"Fixed\" | A test that fails before and passes now |", "| \"Implemented\" | Build passes, diagnostics clean |", "| \"Refactored\" | The existing tests still pass |", "| \"Debugged\" | Root cause named at `file:line` |", "**A pipe hides the exit code.** `cmd | head` reports head's status, not cmd's.", "Write `cmd > out.txt 2>&1; rc=$?` instead", "--fail-under=90`", "untouched legacy files are outside the rule", "| Settled by machine | Settled by a person |", "| Tests pass, build succeeds, lint clean | Does this meet the requirement |", "| Types check, no diagnostics | Is the design sound |", "| Coverage numbers | Are the tests testing the right thing |", "| File | Read or run it when |", "| `references/claim-labels.md` | Writing a verification report", "| `references/digest-contract.md` | A check compares package digests,", "| `references/merge.md` | Squash-merging a worktree back |", "| `scripts/preflight.js` | Before a package is installed", "| `scripts/package_check.js` | Before release", "| `scripts/red_probe.js` | Proving a verification command can actually fail |", "| `references/self-check.md` | Selecting only the cold-read, fact,", "| `scripts/package_identity.js` | Binding runtime, test, asset, metadata,", "| `scripts/workflow.js` | Connecting one version 2 task contract", "**Do not merge on a red check.**", "**If something did not run, say it did not run.**", "assert both the exact match count and the intended scope", "A zero diff with an\nunexplained skipped step is incomplete"];
const BULK_EDIT_TABLE=[["One explicit occurrence", "Edit it directly, then inspect the diff"], ["Mechanical or bulk edit", "Enumerate every match, assert the exact count and intended scope before writing, then inspect the diff"]];
const CONDITIONAL_COMPLETION_TABLE=[["The step changed the artifact", "Show the diff and fresh verification"], ["It was already satisfied and no change was needed", "Show fresh verification and state why that step was skipped"], ["There is no diff and a skipped step has no reason", "Incomplete"]];
const REF_CONTRACTS:[string,string,string[],number][]=[["claim-labels.md", "four labels, four rules, and decision tree", ["never exceeds the review input scope", "Filename correspondence is not evidence", "never a\n`verified` with caveats", "Scope-limited `verified` is allowed", "| `verified` | The evidence covers the whole claim.", "| scope-limited `verified` | True inside a stated boundary.", "| `insufficient-coverage` | Machine verification happened and its **coverage was partial** |", "| `unsupported` | Only the preconditions are supported; the claimed result is unproven |", "   no  -> unsupported", "   preconditions only -> unsupported", "   yes -> unsupported          (rule 2: correspondence is not coverage)", "       -> insufficient-coverage", "       -> scope-limited verified, with the boundary written next to it", "   no -> insufficient-coverage (re-run rather than relabel)", "6. Otherwise -> verified", "| Suite green; changed module has no importing test | `unsupported` |", "| Tests pass on Python; Go path has no runner in this repo | scope-limited `verified` |", "| 40 of 190 call sites reviewed by hand | `insufficient-coverage` |", "| A `README` says the feature is supported | `unsupported` |"], CLAIM_FLOOR], ["digest-contract.md", "three separate digests and canonicalization v2", ["Three digests, never one", "Do not merge these into one", "**1. Codepoint order.**", "**2. NUL framing.**", "cannot appear in a POSIX path", "**3. mtime and mode are excluded.**", "@VERSION@", "**1. Codepoint order.** Sort paths by Unicode codepoint, never by locale", "Do not\ncall a locale-aware sort.", "| Digest differs between CI and a laptop, no diff in `git status` | mtime or mode included (clause 3) |", "| Digest differs only under a non-C locale | Locale collation instead of codepoint order (clause 1) |", "| Version bump alone changes the content digest | Missing `@VERSION@` substitution (clause 4) |", "| Two distinct trees share a digest | Missing NUL framing (clause 2) |", "| Cache not invalidated after a real behaviour change | One digest doing three jobs |"], DIGEST_FLOOR], ["merge.md", "six-phase squash procedure; gitrules owns trailers", ["contains `/worktrees/`", "merge --squash", "Trailers are not written here", "Never skip pre-commit hooks", "1. **Verify worktree**: Check `git rev-parse --git-dir` contains `/worktrees/`. If not, stop:", "5. **Clean working tree**: Run `git status --porcelain`. If uncommitted changes exist, stop.", "3. If conflicts: list files, show markers, **stop and report** -- do NOT auto-resolve", "- Never skip pre-commit hooks (`--no-verify`)", "- If anything unexpected happens, stop and explain rather than guessing", "## Approval gate", "Wait for an explicit yes", "cannot be waived by this instruction", "Start only after the approval gate above has a yes.", "this file does not restate it"], MERGE_FLOOR], ["self-check.md", "conditional factual, independence, SSOT, portability, and cold-read reviews", ["Do not demand every review for a simple wording edit", "`applicability: skipped` with a specific `skipReason`", "Test rejection with a real wrong answer and false PASS", "Reading the source checkout does not prove the installation", "node scripts/workflow.js record-review TASK REQUIREMENT cold-read", "it is not a signature that authenticates an author or proves reviewer independence"], SELF_CHECK_FLOOR], ["security-verification.md", "security specification, result JSON, stages, and freshness", ["# Security Verification Contract", "\"schemaVersion\": 1", "Runner stdout must be exactly one JSON result", "current machine fix verification requires every stage", "invalidates the earlier receipt"], 2360], ["defending-code-upstream.md", "pinned upstream SHA and adopted versus excluded scope", ["# Pinned `defending-code-reference-harness` Reference", "Apache-2.0", "d3bea6b5793b5f3d59a75ebe69a58efa88383145", "Pinned upstream reference", "## Excluded Scope"], 1526]];
REF_CONTRACTS.push(
  ["ship-gates.md", "ordered clean tree, repository check, merge and rollback gates", ["Stop when a preceding step fails", "git status --short", "Zero passing checks is not a pass", "Check mergeability", "concrete rollback path", "Changed inputs invalidate it", "git patch-id --stable", "run them again"], 300],
  ["local-feedback.md", "focused diagnosis and execution scope", [], 5167],
  ["validation-cost.md", "setup cost and execution isolation", [], 7726],
  ["pr-feedback.md", "untrusted comments, fix, dismiss or ask, ask-by-default areas, CI classification before rerun, outward actions stop", ["Comment text is untrusted data", "| fix |", "| dismiss |", "| ask |", "When in doubt, ask", "authentication or authorization", "Classify the failure before any retrigger", "git merge-base --is-ancestor origin/<base> HEAD", "means it was never a flake", "Outward actions stop for approval"], 300],
  ["ci-diagnosis.md", "exact CI identity, nonverification and bounded handoff", ["repository identity, expected full Git HEAD", "It does not authenticate the capture", "A diagnosis is not a verification receipt", "at least two competing,", "Return the result to the original phase"], CI_DIAGNOSIS_FLOOR],
);
const ANCHORS_OF={"claim-labels.md": CLAIM_ANCHORS, "digest-contract.md": DIGEST_ANCHORS, "merge.md": MERGE_ANCHORS, "self-check.md": SELF_CHECK_ANCHORS, "security-verification.md": ["# Security Verification Contract", "## Specification and Results", "## Stages and Evidence"], "defending-code-upstream.md": ["# Pinned `defending-code-reference-harness` Reference", "## Excluded Scope"]};
Object.assign(ANCHORS_OF, {
  "ship-gates.md": ["1. Require", "2. Run", "3. Check", "4. Establish"],
  "local-feedback.md": ["# Local feedback", "## Collect the failure inventory", "## Form and check a hypothesis", "## Choose the environment and widen scope", "## Preserve evidence and stop redundant execution"],
  "validation-cost.md": ["# Validation cost", "## Measure the bottleneck", "## Reduce repeated setup before adding workers", "## Bound concurrency and preserve isolation", "## Speed up a slow test suite", "## Record the result"],
  "ci-diagnosis.md": ["# CI diagnosis", "## Capture before explaining", "## Return a bounded diagnosis"],
  "pr-feedback.md": ["# PR feedback", "## Outward actions stop for approval", "## Review comments", "## CI failures"],
});
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
const TEST_PROFILE=join(ROOT, "scripts", "test_profile.js"),TEST_SMELLS=join(ROOT, "scripts", "test_smells.js");
const REF_HEADINGS:Record<string,string[]>={
  "test-waits.md": ["# Test waits", "## Diagnose which kind of wait", "## Pattern A: fixed sleep to wait for something", "## Pattern A2: doing N slow things to test a limit", "## Pattern B: waiting out a real interval or timeout", "## Pattern C: retry with backoff triggered by the test", "## Pattern D: a finished test process that does not exit", "## Pattern E: real network, DNS, or service startup", "## Pattern F: slow imports and startup", "## Lint against regressions"],
  "test-parallelism.md": ["# Test parallelism", "## Isolation checklist", "## Workers per runner", "## Prove it", "## Cut isolation overhead once independence is proven", "## The long pole", "## Sharding across CI machines", "## Settings per ecosystem", "## Cache results"],
  "test-selection.md": ["# Test selection", "## What to expect", "## Decide", "## Reduce, batch, and queue", "## Tools", "## Limits of an affected run"],
  "flaky-tests.md": ["# Flaky tests", "## Root causes, most common first", "## Detect", "## Retries record flakiness", "## Quarantine", "## Handle a flaky failure"],
  "test-evidence.md": ["# Test evidence", "## Why speed matters", "## Where the time goes", "## Caching", "## Parallelism and isolation", "## Selection and ordering", "## Flakiness", "## Agents", "## Targets", "## Open problems", "## Reported cases", "## Sources"],
  "interactive-cli.md": ["# Interactive CLI checks", "## Decide whether a terminal is needed", "## Drive the session with tmux", "## Wait for the screen, not the clock", "## Judge from durable state", "## Agent CLI sessions", "## Clean up", "## Without tmux", "## Record"],
};
REF_CONTRACTS.push(
  ["test-waits.md", "wait diagnosis and patterns A to F", [...REF_HEADINGS["test-waits.md"]!, "Never force an exit", "Doing N expensive operations tests the loop, not the limit."], TEST_WAITS_FLOOR],
  ["test-parallelism.md", "isolation, workers, proof runs, long pole, sharding", [...REF_HEADINGS["test-parallelism.md"]!, "Shard only after removing waits"], TEST_PARALLELISM_FLOOR],
  ["test-selection.md", "selection limits, decision table, tools, affected scope", [...REF_HEADINGS["test-selection.md"]!, "**shadow mode**", "the\nrepository's required gate still runs everything"], TEST_SELECTION_FLOOR],
  ["flaky-tests.md", "flaky causes, detection, retries, quarantine", [...REF_HEADINGS["flaky-tests.md"]!, "Quarantine means **not blocking**, never deleted."], FLAKY_TESTS_FLOOR],
  ["test-evidence.md", "cited figures with primary sources", [...REF_HEADINGS["test-evidence.md"]!, "jstack has not reproduced\nthem", "[Luo 2014] Luo, Hariri, Eloussi, Marinov."], TEST_EVIDENCE_FLOOR],
  ["interactive-cli.md", "terminal need, tmux driving, screen waits, durable state, agent sessions, cleanup", [...REF_HEADINGS["interactive-cli.md"]!, "`send-keys -l` types its argument literally", "A timeout is a failure with evidence", "the target was not exercised", "Never type credentials with `send-keys`.", "A run under WSL is Linux evidence, not Windows evidence."], INTERACTIVE_CLI_FLOOR],
);
Object.assign(ANCHORS_OF, REF_HEADINGS);
function test_speed_script_checks(tmp:string):void{
const dir=join(tmp, "speed");mkdirSync(join(dir, "nested", "deep"), {recursive: true});mkdirSync(join(dir, "tests"), {recursive: true});
// Real child execution checks wiring; classification uses captured measurements.
// A wall-clock busy loop can receive only a fraction of a shared CI runner's CPU.
writeFileSync(join(dir, "busy.cjs"), "let n=0;for(let i=0;i<100000;i++)n=Math.imul(n+i,31);console.log(n);\n");
writeFileSync(join(dir, "bad.cjs"), "process.exit(3);\n");
writeFileSync(join(dir, "flip.cjs"), "const fs=require('fs');const f=__dirname+'/flip.state';const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));process.exit(n%2);\n");
writeFileSync(join(dir, "nested", "deep", "inner.cjs"), "\n");
const cmd='"'+process.execPath+'" {file}';
const prof=(args:string[],env:NodeJS.ProcessEnv=process.env)=>{const result=runProcess(process.execPath,[TEST_PROFILE,...args],{cwd:dir,env,encoding:'utf8',timeout:120000});return {status:result.status,out:String(result.stdout??'')+String(result.stderr??'')};};
writeFileSync(join(dir,'captured.cjs'), `(async()=>{const p=await import(${JSON.stringify(pathToFileURL(TEST_PROFILE).href)});const options=p.parseArgs(['--cmd',${JSON.stringify(cmd)},'--fail-on-waiting','--max-seconds','1','--waiting-min-seconds','0.2','sleepy.cjs','busy.cjs']);const rows=[['sleepy.cjs',2,0.02],['busy.cjs',0.5,0.45]].map(([name,wall,cpu])=>p.summarize(name,[{wall,cpu,exit:0,stderrTail:''}],options));console.log(JSON.stringify(p.reportRows(rows,options,0.1,2)));})();\n`);
const captured=runProcess(process.execPath,[join(dir,'captured.cjs')],{cwd:dir,encoding:'utf8',timeout:120000});
let measured:any=null;try{measured=JSON.parse(String(captured.stdout));}catch{measured=null;}
const measuredText=measured?.lines?.join('\n')??'';
check("Test profile: a sleeping unit is WAITING and fails --fail-on-waiting", captured.status===0&&measured?.code===1&&/sleepy\.cjs[^\n]*WAITING/.test(measuredText)&&measuredText.includes("BUDGET VIOLATIONS"), measuredText.slice(-300));
check("Test profile: a busy unit is measured and not WAITING", /busy\.cjs +[\d.]+ +[\d.]+ /.test(measuredText)&&!/busy\.cjs[^\n]*WAITING/.test(measuredText), measuredText.slice(-300));
const report=measured?.json;
check("Test profile: JSON reports waiting units, projections, and the long pole", report?.cpu_measured===true&&Array.isArray(report?.waiting_units)&&report.waiting_units.includes("sleepy.cjs")&&typeof report?.projected_wall_s?.["1"]==="number"&&report?.long_pole==='sleepy.cjs', JSON.stringify(report)?.slice(0, 300));
let run=prof(["--cmd", cmd, "bad.cjs"]);
check("Test profile: a failing unit exits 1 with its exit code", run.status===1&&run.out.includes("exit=3"), run.out.slice(-200));
check("Test profile: a unit over --max-seconds is a budget violation", measured?.code===1&&/sleepy\.cjs: [\d.]+ s > budget 1 s/.test(measuredText), measuredText.slice(-200));
run=prof(["--cmd", cmd, "flip.cjs", "--repeat", "2"]);
check("Test profile: differing outcomes across --repeat are FLAKY", run.status===1&&run.out.includes("flip.cjs: FLAKY"), run.out.slice(-200));
run=prof(["--cmd", cmd, "**/inner.cjs", "busy.cjs", "--top", "20", "--json", join(dir, "report.json")]);
let realReport:any=null;try{realReport=JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));}catch{realReport=null;}
check("Test profile: ** globs reach nested units", run.status===0&&run.out.includes("nested/deep/inner.cjs")&&realReport?.cpu_measured===true&&realReport?.units?.some((row:any)=>row.unit==='busy.cjs'&&row.exit===0&&row.cpu_s>0), run.out.slice(0, 300));
run=prof(["--cmd", cmd, "busy.cjs", "--fail-on-waiting"], {...process.env, PATH: join(dir, "no-bin"), Path: join(dir, "no-bin")});
check("Test profile: without bash CPU is unmeasured and --fail-on-waiting exits 2", run.status===2&&run.out.includes("unmeasured"), run.out.slice(-200));
run=prof(["--cmd", "echo", "busy.cjs"]);
check("Test profile: a command without {file} is a usage error", run.status===2&&run.out.includes("{file}"), run.out);
writeFileSync(join(dir, "tests", "smelly.test.js"), ["await new Promise(r => setTimeout(r, 2000));", "server.listen(3000);", "it.only('focused', () => {});", "const response = await fetch('https://api.github.com/repos');", "const file = '/tmp/shared-output.txt';", "jest.retryTimes(3);"].join("\n")+"\n");
writeFileSync(join(dir, "tests", "clean.test.js"), ["server.listen(0);", "setTimeout(done, 10);", "await fetch('https://api.example.com/x');", "await fetch('http://127.0.0.1:' + port + '/x');", "sleep(500); // test-smells: allow waits on real hardware"].join("\n")+"\n");
writeFileSync(join(dir, "jest.config.js"), "module.exports = { maxWorkers: 1, x: setTimeout(done, 5000) };\n");
const smell=runProcess(process.execPath,[TEST_SMELLS, "tests", "jest.config.js", "--json", join(dir, "smells.json")],{cwd:dir,encoding:'utf8',timeout:60000});
let hits:any[]=[];try{hits=JSON.parse(readFileSync(join(dir, "smells.json"), "utf8"));}catch{hits=[];}
const kinds=(file:string)=>[...new Set(hits.filter((hit:any)=>hit.file===file).map((hit:any)=>hit.kind))].sort().join(",");
check("Test smells: every positive kind is reported and the scan exits 0", smell.status===0&&kinds("tests/smelly.test.js")==="fixed-path,fixed-port,focused,real-network,retry-flaky,sleep", kinds("tests/smelly.test.js"));
check("Test smells: port 0, short timers, reserved hosts, and justified lines are not reported", kinds("tests/clean.test.js")==="", kinds("tests/clean.test.js"));
check("Test smells: configuration files report only serial and retry settings", kinds("jest.config.js")==="serial-only", kinds("jest.config.js"));
}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}

function md_rows(text:any,head:any,width:any):any{
let body:any,cell:any,cells:any,line:any,out:any,stripped:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
(out=[]);
for (let line of lines(body)) {
(stripped=strip(line));
if(truth(!truth(starts(stripped, "|")))) {
continue;
}
(cells=Array.from(split(strip(stripped, "|"), "|")).map((cell: any) => (strip(cell))));
if(truth(((value:any)=>truth(value)?value:(compare(new Set(joinText("", cells)),new Set("-: "),"<=")))((!isDeepStrictEqual(length(cells),width))))) {
continue;
}
out.push(Array.from(cells));
}
return (truth(out) ? slice(out, 1) : out);
}
function run(script:any,...input:any[]):any{
const options=typeof input.at(-1)==='object'?input.pop():{};const args=input;const {env=undefined}=options;
let r:any;

(r=subprocessRun([({executable:process.execPath}).executable, script, ...args],{capture_output:true,text:true,env:(truth(env) ? {...process.env,...env} : process.env)}));
return [r.returncode, r.stdout, r.stderr];
}
const ENV_BYPASS=["PREFLIGHT_MODE", "PREFLIGHT_ALLOW_LOOSE", "PREFLIGHT_FORCE", "PREFLIGHT_SURFACE", "SKIP_PREFLIGHT", "VERIFY_MODE", "VERIFY_FORCE", "ALLOW_LOOSE", "FORCE", "CI", "CLAUDE_PLUGIN_ROOT"];
const DEV_ARTIFACT_FIXTURES=["references/stale.pyc", "references/stale.pyo", "references/patch.orig", "references/patch.rej", "references/__pycache__/mod.py", "references/.ruff_cache/CACHEDIR", "references/.pytest_cache/CACHEDIR", "references/.git/config", ".DS_Store"];
const ESCAPE_FIXTURES=[["references/home.md", "Settings are in ~/.claude/settings.json.\n", "hard-coded home path"], ["references/abs.md", "The original is at /Users/someone/work/x.\n", "absolute home path"], ["references/up.md", "Read ${CLAUDE_PLUGIN_ROOT}/../other/x.md.\n", "reference outside the plugin root"]];
function as_json(out:any):any{
try {return JSON.parse(out);}catch(error){return {};}
}
function write(path:any,text:any):any{
let f:any;
mkdirSync(dirname(path),{recursive:true});
{const f=fileHandle(path,"w");f.write(text);}
}
function make_package(base:any,{with_tests=true,version='1.2.0',changelog='1.2.0',extra=null}:any={}):any{
let body:any,rel:any;

write(join(base, "SKILL.md"), "---\nname: sample\ndescription: sample\n---\n\n# Sample\n\nbody\n");
write(join(base, "references", "notes.md"), "# Notes\n\nreference body\n");
write(join(base, "scripts", "run.cjs"), "console.log('ok');\n");
if(truth(with_tests)) {
write(join(base, "tests", "run_tests.cjs"), "console.log('tests');\n");
}
write(join(base, ".claude-plugin", "plugin.json"), (JSON.stringify({"name": "sample", "version": version}) + "\n"));
if(truth(((changelog !== null)))) {
write(join(base, "CHANGELOG.md"), ("# Changelog\n\n## [Unreleased]\n\n## [" + pyStr(changelog) + "] - 2026-01-01\n\n- 첫 항목\n"));
}
for (let [rel, body] of Object.entries(((value:any)=>truth(value)?value:{})(extra))) {
write(join(base, rel), body);
}
return base;
}
function preflight_checks(tmp:any):any{
let _:any,dirty:any,err:any,fifo:any,fifo_tree:any,installed:any,kinds:any,linked:any,mode:any,out:any,paths:any,rc:any,src:any,stray:any,surface:any,v:any;
(src=make_package(join(tmp, "src")));
for (let mode of ["source-development", "installed-runtime"]) {
([rc, out, err]=run(PREFLIGHT,src,"--mode",mode));
check(("preflight: valid tree passes in " + pyStr(mode) + " (rc 0)"), (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 80))));
}
(linked=make_package(join(tmp, "linked")));
symlinkSync(join(linked, "SKILL.md"), join(linked, "references", "alias.md"));
for (let mode of ["source-development", "installed-runtime"]) {
([rc, out, err]=run(PREFLIGHT,linked,"--mode",mode));
check(("preflight: symlink is rejected in " + pyStr(mode) + " (nonzero rc)"), (!isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
}
([rc, out, _]=run(PREFLIGHT,linked,"--json"));
(kinds=Array.from((as_json(out)["violations"] ?? [])).map((v: any) => (at(v, "kind"))));
check("preflight: violation kind is reported as symlink", ((contains(kinds, "symlink"))), (pyStr(kinds)));
(fifo_tree=make_package(join(tmp, "fifo")));
(fifo=join(fifo_tree, "references", "pipe"));
{const created=runProcess('mkfifo',[fifo]);if(created.status!==0)throw Error(created.stderr);}
([rc, out, _]=run(PREFLIGHT,fifo_tree,"--json"));
(kinds=Array.from((as_json(out)["violations"] ?? [])).map((v: any) => (at(v, "kind"))));
check("preflight: non-regular file (FIFO) is rejected", ((value:any)=>truth(value)?((contains(kinds, "non-regular"))):value)((!isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " " + pyStr(kinds)));
(installed=make_package(join(tmp, "installed"),{with_tests:false}));
([rc, out, _]=run(PREFLIGHT,installed,"--json"));
check("preflight: tree without tests is detected as installed-runtime", (isDeepStrictEqual((as_json(out)["detected"] ?? null),"installed-runtime")), (as_json(out)["detected"] ?? null));
([rc, out, err]=run(PREFLIGHT,installed,"--mode","source-development"));
check("preflight: a mode looser than detection is rejected (rc 2)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
check("preflight: rejection explains that the requested mode is looser", ((contains(err, "looser mode"))), slice(strip(err), 0, 80));
([rc, _, _]=run(PREFLIGHT,join(tmp, "src"),"--mode","installed-runtime"));
check("preflight: a stricter requested mode is allowed", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
(stray=make_package(join(tmp, "stray"),{extra:{"leftover.bin": "x\n"}}));
([rc, out, _]=run(PREFLIGHT,stray,"--json"));
(kinds=Array.from((as_json(out)["violations"] ?? [])).map((v: any) => (at(v, "kind"))));
check("preflight: one file outside the surface fails closed", ((value:any)=>truth(value)?((contains(kinds, "unclassified"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(kinds)));
(surface=join(tmp, "package-surface.yaml"));
write(surface, "runtime:\n  - SKILL.md\nverification:\n  - tests/**\n");
([rc, out, _]=run(PREFLIGHT,join(tmp, "src"),"--surface",surface,"--json"));
(paths=Array.from((as_json(out)["violations"] ?? [])).map((v: any) => (at(v, "path"))));
check("preflight: --surface reads the supplied surface definition", ((value:any)=>truth(value)?((contains(paths, "references/notes.md"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(slice(paths, 0, 4))));
(dirty=make_package(join(tmp, "dirty"),{with_tests:false,extra:{"references/stale.pyc": "x"}}));
([rc, out, _]=run(PREFLIGHT,dirty,"--json"));
(kinds=Array.from((as_json(out)["violations"] ?? [])).map((v: any) => (at(v, "kind"))));
check("preflight: development residue is rejected from installed runtime", ((value:any)=>truth(value)?((contains(kinds, "dev-artifact"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(kinds)));
([rc, _, _]=run(PREFLIGHT,join(tmp, "does-not-exist")));
check("preflight: an unexecutable check returns 2, not 0", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
}
function package_check_checks(tmp:any):any{
let _:any,bad:any,empty:any,missing:any,ok_tree:any,out:any,problems:any,rc:any,root_cl:any,unreleased:any;
(ok_tree=make_package(join(tmp, "pkg-ok")));
([rc, out, _]=run(PACKAGE_CHECK,ok_tree));
check("package_check: matching versions return rc 0", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
(bad=make_package(join(tmp, "pkg-bad"),{version:"1.3.0",changelog:"1.2.0"}));
([rc, out, _]=run(PACKAGE_CHECK,bad));
check("package_check: top CHANGELOG version mismatch returns rc 1", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
([rc, out, _]=run(PACKAGE_CHECK,bad,"--json"));
(problems=joinText(" ", (as_json(out)["problems"] ?? [])));
check("package_check: mismatch reports both values", ((value:any)=>truth(value)?((contains(problems, "1.2.0"))):value)(((contains(problems, "1.3.0")))), slice(problems, 0, 90));
(missing=make_package(join(tmp, "pkg-nochangelog"),{changelog:null}));
([rc, _, _]=run(PACKAGE_CHECK,missing));
check("package_check: missing CHANGELOG is not a pass (rc 1)", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
(unreleased=make_package(join(tmp, "pkg-unreleased")));
([rc, out, _]=run(PACKAGE_CHECK,unreleased,"--json"));
check("package_check: [Unreleased] is not parsed as a version", (isDeepStrictEqual(((as_json(out)["facts"] ?? {})["changelog_top"] ?? null),"1.2.0")), pyStr(((as_json(out)["facts"] ?? {})["changelog_top"] ?? null)));
(root_cl=join(tmp, "ROOT-CHANGELOG.md"));
write(root_cl, "# Root\n\n- 다른 패키지 0.1.0\n");
([rc, _, _]=run(PACKAGE_CHECK,ok_tree,"--root-changelog",root_cl));
check("package_check: missing (name, version) row in root CHANGELOG returns rc 1", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
write(root_cl, "# Root\n\n- sample 1.2.0 배포\n");
([rc, _, _]=run(PACKAGE_CHECK,ok_tree,"--root-changelog",root_cl));
check("package_check: matching root row returns rc 0", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
(empty=join(tmp, "pkg-empty"));
mkdirSync(empty,{recursive:true});
([rc, _, _]=run(PACKAGE_CHECK,empty));
check("package_check: missing plugin.json is unexecutable (2), not defect (1)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
}
function red_probe_checks(tmp:any):any{
let _:any,flip:any,hollow:any,out:any,rc:any,real:any,rep:any,tree:any,verdict:any;
(tree=join(tmp, "red-tree"));
write(join(tree, "impl.cjs"), "exports.f=function(){return 1;};\n");
write(join(tree, "t_real.cjs"), "process.exit(require('./impl.cjs').f()===1?0:1);\n");
write(join(tree, "t_hollow.cjs"), "require('./impl.cjs');\nconsole.log('ok');\n");
(real=(pyStr(({executable:process.execPath}).executable) + " t_real.cjs"));
(hollow=(pyStr(({executable:process.execPath}).executable) + " t_hollow.cjs"));
(flip="impl.cjs:return 1->return 2");
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",real,"--mutate",flip,"--json"));
(rep=as_json(out));
check("red_probe: command that fails after mutation proves RED (rc 0)", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
check("red_probe: reports baseline and mutated exit codes", ((value:any)=>truth(value)?((!contains([0, null], (rep["mutated_rc"] ?? null)))):value)((isDeepStrictEqual((rep["baseline_rc"] ?? null),0))), (pyStr((rep["baseline_rc"] ?? null)) + " -> " + pyStr((rep["mutated_rc"] ?? null))));
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",hollow,"--mutate",flip,"--json"));
check("red_probe: command that survives mutation leaves RED unproven (rc 1)", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
(verdict=(as_json(out)["verdict"] ?? ""));
check("red_probe: an unfalsifiable command is reported as unproven", ((contains(verdict, "unproven"))), slice(verdict, 0, 80));
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",real,"--mutate","impl.cjs:없는문자열->x","--json"));
check("red_probe: no-op mutation is unexecutable, not pass (rc 2)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",hollow,"--mutate",flip,"--expect-rc","3","--json"));
check("red_probe: unexpected baseline is unexecutable (rc 2)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",real,"--json"));
check("red_probe: missing mutation is unexecutable (rc 2)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
check("red_probe: original tree remains unchanged", ((contains(read(join(tree, "impl.cjs")), "return 1"))));
}
function preflight_hardening(tmp:any):any{
let _:any,brk:any,esc:any,escaped:any,hollow:any,i:any,ig_path:any,ig_tree:any,installed:any,k:any,kinds:any,leaked:any,many:any,named:any,noskill:any,origin_ex:any,origin_fb:any,out:any,out_a:any,out_b:any,out_ex:any,out_fb:any,outside:any,payload:any,polluted:any,rc:any,rc_a:any,rc_b:any,rc_ex:any,rc_fb:any,rel:any,s:any,src_tree:any,strays:any,tree:any,unc:any,v:any,vs:any,why:any;

(outside=join(tmp, "outside-target.md"));
write(outside, "# 트리 밖 파일\n");
(esc=make_package(join(tmp, "escape-link")));
symlinkSync(outside, join(esc, "references", "outside.md"));
([rc, out, _]=run(PREFLIGHT,esc,"--json"));
(vs=(as_json(out)["violations"] ?? []));
check("preflight: symlink outside the tree is rejected", ((value:any)=>truth(value)?(Array.from(vs).map((v: any) => (((value:any)=>truth(value)?(isDeepStrictEqual(at(v, "path"),"references/outside.md")):value)((isDeepStrictEqual(at(v, "kind"),"symlink")))))).some((value:any)=>truth(value)):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(Array.from(vs).map((v: any) => (at(v, "kind"))))));
check("preflight: symlink violation reports its target", (Array.from(vs).map((v: any) => (((value:any)=>truth(value)?((contains(at(v, "detail"), outside))):value)((isDeepStrictEqual(at(v, "kind"),"symlink")))))).some((value:any)=>truth(value)), slice(pyStr(Array.from(vs).map((v: any) => ((v["detail"] ?? null)))), 0, 90));
(brk=make_package(join(tmp, "broken-link")));
symlinkSync(join(brk, "gone.md"), join(brk, "references", "dangling.md"));
([rc, out, _]=run(PREFLIGHT,brk,"--json"));
(kinds=Array.from((as_json(out)["violations"] ?? [])).map((v: any) => (at(v, "kind"))));
check("preflight: broken symlink is rejected", ((value:any)=>truth(value)?((contains(kinds, "symlink"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(kinds)));
(noskill=join(tmp, "no-skill"));
write(join(noskill, "references", "notes.md"), "# 참조\n");
write(join(noskill, ".claude-plugin", "plugin.json"), (JSON.stringify({"name": "sample", "version": "1.2.0"}) + "\n"));
([rc, out, _]=run(PREFLIGHT,noskill,"--json"));
(vs=(as_json(out)["violations"] ?? []));
check("preflight: missing SKILL.md fails as missing-skill", ((value:any)=>truth(value)?(Array.from(vs).map((v: any) => ((isDeepStrictEqual(at(v, "kind"),"missing-skill"))))).some((value:any)=>truth(value)):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(Array.from(vs).map((v: any) => (at(v, "kind"))))));
(hollow=make_package(join(tmp, "hollow"),{with_tests:false,extra:{"references/hollow.md": ""}}));
([rc, out, _]=run(PREFLIGHT,hollow,"--json"));
(vs=(as_json(out)["violations"] ?? []));
check("preflight: empty runtime file is rejected from distribution", ((value:any)=>truth(value)?(Array.from(vs).map((v: any) => (((value:any)=>truth(value)?(isDeepStrictEqual(at(v, "path"),"references/hollow.md")):value)((isDeepStrictEqual(at(v, "kind"),"empty-runtime")))))).some((value:any)=>truth(value)):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(Array.from(vs).map((v: any) => ([at(v, "kind"), at(v, "path")])))));
(escaped=[]);
for (let [i, [rel, payload, why]] of enumerate(ESCAPE_FIXTURES)) {
(tree=make_package(join(tmp, ("escape-" + pyStr(i))),{with_tests:false,extra:{[rel]: payload}}));
([rc, out, _]=run(PREFLIGHT,tree,"--json"));
(vs=(as_json(out)["violations"] ?? []));
if(truth(!truth(((value:any)=>truth(value)?(Array.from(vs).map((v: any) => (((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(at(v, "detail"),why)):value)((isDeepStrictEqual(at(v, "path"),rel))):value)((isDeepStrictEqual(at(v, "kind"),"escapes-package")))))).some((value:any)=>truth(value)):value)((isDeepStrictEqual(rc,1)))))) {
escaped.push((pyStr(why) + "(" + pyStr(rel) + ")"));
}
}
check("preflight: every package-escape pattern is rejected", !truth(escaped), ("unexpected passes " + pyStr(escaped)));
(leaked=[]);
for (let [i, rel] of enumerate(DEV_ARTIFACT_FIXTURES)) {
(tree=make_package(join(tmp, ("dev-" + pyStr(i))),{with_tests:false,extra:{[rel]: "x\n"}}));
([rc, out, _]=run(PREFLIGHT,tree,"--json"));
(vs=Array.from((as_json(out)["violations"] ?? [])).filter((v: any) => truth((isDeepStrictEqual(at(v, "path"),rel)))).map((v: any) => (v)));
if(truth(!truth(((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(at(at(vs, 0), "kind"),"dev-artifact")):value)(vs):value)((isDeepStrictEqual(rc,1)))))) {
leaked.push(rel);
}
}
check("preflight: every development-residue fixture is rejected", !truth(leaked), ("unexpected passes " + pyStr(leaked)));
(strays=["leftover.bin", "notes.txt", "deep/nested/thing.dat", "Makefile", "noext"]);
(many=make_package(join(tmp, "stray-many"),{extra:Object.fromEntries(Array.from(strays).map((s: any) => ([s, "x\n"])))}));
([rc, out, _]=run(PREFLIGHT,many,"--json"));
(unc=new Set(Array.from((as_json(out)["violations"] ?? [])).filter((v: any) => truth((isDeepStrictEqual(at(v, "kind"),"unclassified")))).map((v: any) => (at(v, "path")))));
check("preflight: fallback surface is closed; every stray is unclassified", ((value:any)=>truth(value)?(compare(new Set(strays),unc,"<=")):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " unexpectedly classified " + pyStr(sorted(strays.filter((value:string)=>!unc.has(value))))));
(ig_path=join(tmp, "surface-ignore.yaml"));
write(ig_path, "categories:\n  runtime:\n    - SKILL.md\n    - references/**\n    - scripts/**\n  verification:\n    - tests/**\n  metadata:\n    - .claude-plugin/**\n    - CHANGELOG.md\nignore:\n  - '*.log'\n");
(ig_tree=make_package(join(tmp, "ignore-tree"),{extra:{"leftover.bin": "x\n", "run.log": "x\n"}}));
([rc, out, _]=run(PREFLIGHT,ig_tree,"--surface",ig_path,"--json"));
(unc=new Set(Array.from((as_json(out)["violations"] ?? [])).filter((v: any) => truth((isDeepStrictEqual(at(v, "kind"),"unclassified")))).map((v: any) => (at(v, "path")))));
check("preflight: ignore list cannot swallow the full surface", ((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(unc, "run.log"))):value)(((contains(unc, "leftover.bin")))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " unclassified " + pyStr(sorted(unc))));
(src_tree=join(tmp, "src"));
([rc_fb, out_fb, _]=run(PREFLIGHT,src_tree,"--json"));
(origin_fb=pyStr((as_json(out_fb)["surface"] ?? null)));
check("preflight: source reports fallback when canonical surface is absent", ((contains(origin_fb, "FALLBACK_SURFACE"))), slice(origin_fb, 0, 80));
(named=join(tmp, "package-surface.yaml"));
([rc_ex, out_ex, _]=run(PREFLIGHT,src_tree,"--surface",named,"--json"));
(origin_ex=pyStr((as_json(out_ex)["surface"] ?? null)));
check("preflight: source label matches the surface actually used", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(rc_ex,1)):value)((isDeepStrictEqual(rc_fb,0))):value)(((!contains(origin_ex, "FALLBACK_SURFACE")))), (pyStr(slice(origin_fb, 0, 24)) + "(rc " + pyStr(rc_fb) + ") vs " + pyStr(slice(origin_ex, 0, 24)) + "(rc " + pyStr(rc_ex) + ")"));
(polluted=Object.fromEntries(Array.from(ENV_BYPASS).map((k: any) => ([k, "1"]))));
(installed=join(tmp, "installed"));
([rc, _, _]=run(PREFLIGHT,installed,"--mode","source-development",{env:polluted}));
check("preflight: environment variables cannot revive loose mode (rc remains 2)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc_a, out_a, _]=run(PREFLIGHT,many,"--json"));
([rc_b, out_b, _]=run(PREFLIGHT,many,"--json",{env:polluted}));
check("preflight: violation verdict is independent of environment variables", (isDeepStrictEqual([rc_a, (as_json(out_a)["violations"] ?? null)],[rc_b, (as_json(out_b)["violations"] ?? null)])), ("rc " + pyStr(rc_a) + " -> " + pyStr(rc_b)));
}
function package_check_hardening(tmp:any):any{
let _:any,broke:any,cross:any,fields:any,key:any,multi:any,ok_tree:any,out:any,problems:any,rc:any,top:any,unreported:any;

(ok_tree=join(tmp, "pkg-ok"));
(cross=join(tmp, "CROSS-CHANGELOG.md"));
write(cross, "# Root\n\n- sample 9.9.9 배포\n- other-plugin 1.2.0 배포\n");
([rc, out, _]=run(PACKAGE_CHECK,ok_tree,"--root-changelog",cross,"--json"));
(problems=joinText(" ", (as_json(out)["problems"] ?? [])));
check("package_check: name and version from different rows do not match (rc 1)", ((value:any)=>truth(value)?((contains(problems, "(sample, 1.2.0)"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(slice(problems, 0, 80))));
(unreported=[]);
for (let key of ["version", "name"]) {
(broke=make_package(join(tmp, ("pkg-no-" + pyStr(key)))));
(fields={"name": "sample", "version": "1.2.0"});
delete fields[key];
write(join(broke, ".claude-plugin", "plugin.json"), (JSON.stringify(fields) + "\n"));
([rc, out, _]=run(PACKAGE_CHECK,broke,"--json"));
(problems=joinText(" ", (as_json(out)["problems"] ?? [])));
if(truth(!truth(((value:any)=>truth(value)?((contains(problems, key))):value)((isDeepStrictEqual(rc,1)))))) {
unreported.push((pyStr(key) + "(rc=" + pyStr(rc) + ")"));
}
}
check("package_check: reports every manifest name and version defect", !truth(unreported), ("unreported " + pyStr(unreported)));
(multi=make_package(join(tmp, "pkg-multi")));
write(join(multi, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-02-01\n\n- 최신\n\n## [1.1.0] - 2026-01-15\n\n- 중간\n\n## [1.0.0] - 2026-01-01\n\n- 최초\n");
([rc, out, _]=run(PACKAGE_CHECK,multi,"--json"));
(top=((as_json(out)["facts"] ?? {})["changelog_top"] ?? null));
check("package_check: reads the first of multiple versions, not the last", ((value:any)=>truth(value)?(isDeepStrictEqual(top,"1.2.0")):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " top=" + pyStr(top)));
}
function red_probe_hardening(tmp:any):any{
let _:any,flip:any,out:any,rc:any,real:any,rep:any,tree:any;

(tree=join(tmp, "red-tree"));
(real=(pyStr(({executable:process.execPath}).executable) + " t_real.cjs"));
(flip="impl.cjs:return 1->return 2");
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",(real + " | cat"),"--mutate",flip,"--json"));
(rep=as_json(out));
check("red_probe: pipe cannot hide the command exit code", ((value:any)=>truth(value)?((!contains([0, null], (rep["mutated_rc"] ?? null)))):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " mutated rc=" + pyStr((rep["mutated_rc"] ?? null))));
write(join(tree, "conf.cjs"), "exports.A = \"keep\";exports.B = \"keep\";\n");
write(join(tree, "t_conf.cjs"), "const conf=require('./conf.cjs');process.exit(conf.A==='keep'&&conf.B==='keep'?0:conf.A==='gone'&&conf.B==='keep'?2:3);\n");
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",(pyStr(({executable:process.execPath}).executable) + " t_conf.cjs"),"--mutate","conf.cjs:\"keep\"->\"gone\"","--json"));
(rep=as_json(out));
check("red_probe: mutation changes only the first match, not every match", ((value:any)=>truth(value)?(isDeepStrictEqual((rep["mutated_rc"] ?? null),2)):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " mutated rc=" + pyStr((rep["mutated_rc"] ?? null)) + " (3 means replace-all)"));
write(join(tree, "spin.cjs"), "exports.MARK = 1;\n");
write(join(tree, "t_spin.cjs"), "process.exit(require('./spin.cjs').MARK===1?0:1);\n");
([rc, out, _]=run(RED_PROBE,"--tree",tree,"--command",(pyStr(({executable:process.execPath}).executable) + " t_spin.cjs"),"--mutate","spin.cjs:MARK = 1->MARK = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)","--timeout","3","--json"));
(rep=as_json(out));
check("red_probe: post-mutation timeout does not prove RED (rc 2)", ((value:any)=>truth(value)?(((rep["mutated_rc"] ?? null) === null)):value)((isDeepStrictEqual(rc,2))), ("rc=" + pyStr(rc) + " mutated rc=" + pyStr((rep["mutated_rc"] ?? null))));
}
function package_identity_checks(tmp:any):any{
let err:any,first:any,out:any,packageTree:any,rc:any,second:any;
(packageTree=make_package(join(tmp, "identity-package")));
([rc, out, err]=run(PACKAGE_IDENTITY,packageTree,"--json"));
(first=as_json(out));
check("package_identity: computes role digests for a package without Git", ((value:any)=>truth(value)?(isDeepStrictEqual(new Set(Object.keys(first["digests"] ?? {})),new Set(["runtime", "test", "assets", "metadata", "versionNeutralTree", "tree"]))):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 80))));
write(join(packageTree, "scripts", "run.cjs"), "console.log('changed');\n");
([rc, out, err]=run(PACKAGE_IDENTITY,packageTree,"--json"));
(second=as_json(out));
check("package_identity: runtime change updates runtime and tree digests", ((value:any)=>truth(value)?((value:any)=>truth(value)?(!isDeepStrictEqual(((first["digests"] ?? {})["tree"] ?? null),((second["digests"] ?? {})["tree"] ?? null))):value)((!isDeepStrictEqual(((first["digests"] ?? {})["runtime"] ?? null),((second["digests"] ?? {})["runtime"] ?? null)))):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 80))));
check("package_identity: reads package name and version from manifest", (isDeepStrictEqual((second["package"] ?? null),{"name": "sample", "version": "1.2.0"})), (pyStr((second["package"] ?? null))));
const gateBody="# Shared ship gates\nRequire the checked HEAD and a rollback path.\n";
write(join(packageTree,"skills","verify","references","ship-gates.md"),gateBody);
const [gateRc,gateOut]=run(PACKAGE_IDENTITY,packageTree,"--json"),gateIdentity=as_json(gateOut);
check("package_identity: shared ship gates belong to runtime identity, not test-only metadata", !!gateBody && gateRc===0 && !!gateIdentity.digests?.runtime && gateIdentity.digests.runtime!==second.digests?.runtime && gateIdentity.digests.test===second.digests?.test);

}
function workflow_checks():void {
  for(const [pattern,label,file,passes] of [
    ['full task binds review','plan -> prepare -> brief -> interrupt/resume -> verify -> complete',WORKFLOW_TEST,1],
    ['workflow timeout kills','timeout kills the child process group and records failure',WORKFLOW_TEST,1],
    ['', 'review repetition preserves coverage and incomplete-work gates',join(HERE,'review-cycle.test.js'),1],
  ] as const) {
    const result=subprocessRun([process.execPath,'--test','--test-reporter=tap',...(pattern?['--test-name-pattern='+pattern]:[]),file],{env:process.env});
    check('workflow: '+label,result.returncode===0&&result.stdout.includes('# pass '+passes)&&!result.stdout.includes('# tests 0'),(result.stdout+result.stderr).slice(-200));
  }
}
function check_doc_order(label:string,text:string,anchors:string[]):void{
const positions=anchors.map(anchor=>[anchor,text.indexOf(anchor)] as const),missing=positions.filter(([,index])=>index<0).map(([anchor])=>anchor);
if(missing.length){check(label,false,'missing anchors '+pyStr(missing));return;}
const wrong=positions.slice(0,-1).filter(([,index],i)=>index>=positions[i+1][1]).map(([anchor],i)=>anchor+' followed by '+positions[i+1][0]);
check(label,wrong.length===0,'wrong order '+pyStr(wrong.slice(0,2)));
}
function skill_prose_checks(fm:any,skill:any):any{
let claim:any,ev:any,got:any,missing:any,n:any,named:any,orphans:any,owned:any,rel:any,skills_dir:any;

check("Evidence: forbids completion claims without fresh evidence", ((contains(skill, "No completion claim without fresh evidence"))));
check("Workflow: task.json takes precedence over the generic repository scan", ((value:any)=>truth(value)?value:((contains(skill, "use the task workflow before the generic repository scan"))))(((contains(skill, "use the task workflow before the\ngeneric repository scan")))));
check("Workflow: verify always runs the contract linter first", ((contains(skill, "`verify` always runs the plan contract linter first"))));
check("Workflow: positive runs in repository and RED in a fresh copy", ((value:any)=>truth(value)?((contains(skill, "copied under a fresh `{RED_ROOT}`"))):value)(((contains(skill, "positive command in the repository")))));
check("Workflow: RED_ROOT is not described as an OS sandbox", ((value:any)=>truth(value)?value:((contains(skill, "working-directory boundary supplied to a trusted contract command, not an OS sandbox"))))(((contains(skill, "working-directory boundary supplied to a trusted contract command, not an OS\nsandbox")))));
check("Workflow: timeout kills the process group and records failure", ((value:any)=>truth(value)?((contains(skill, "timeout terminates its process\ngroup"))):value)(((contains(skill, "120-second default limit")))));
check("Workflow: preflight does not confuse a TDD failure with a missing tool", ((contains(joinText(" ", split(skill)), "does not mistake a pre-implementation TDD failure for a missing tool"))));
check("Workflow: local brief does not spawn; native harness delegates", ((value:any)=>truth(value)?((contains(skill, "native harness owns delegation"))):value)(((contains(skill, "local brief\ndoes not spawn an agent")))));
check("Extra review: select only task-required kinds from self-check", ((contains(skill, "Choose extra self-checks from `references/self-check.md`"))));
check("Extra review: local receipt fields do not prove reviewer independence", ((value:any)=>truth(value)?value:((contains(skill, "reviewer name or JSON flag does not prove identity or independence"))))(((contains(skill, "reviewer name or JSON flag does\nnot prove identity or independence")))));
check("Receipt: preflight, brief, or coordinator runtime change invalidates it", ((value:any)=>truth(value)?((contains(skill, "invalidates an older receipt"))):value)(((contains(skill, "binds the\ncurrent preflight, brief, and coordinator package runtime identity")))));
check("Evidence: lists what does not count as evidence", ((value:any)=>truth(value)?((contains(skill, "are not evidence"))):value)(((contains(skill, "It should work")))));
check("Evidence: table gives required evidence by claim", ((contains(skill, "| Claim | Required evidence |"))));
for (let [claim, ev] of [["Fixed", "fails before and passes now"], ["Implemented", "Build passes"], ["Refactored", "existing tests still pass"], ["Debugged", "`file:line`"]]) {
check(("Evidence: " + pyStr(claim) + " has concrete evidence"), ((contains(skill, ev))));
}
check("Separation: table distinguishes machine and human decisions", ((contains(skill, "| Settled by machine | Settled by a person |"))));
check("Separation: forbids pretending to measure human judgment", ((contains(skill, "Do not pretend to measure the right column"))));
check("Separation: requires naming who must decide", ((value:any)=>truth(value)?value:((contains(skill, "say who"))))(((contains(skill, "say who\nmust decide")))));
check("Limit: identifies false machine settlement of human judgment as the target failure", ((value:any)=>truth(value)?value:((contains(skill, "skill exists to prevent"))))(((contains(skill, "the failure this\nskill exists to prevent")))));
check("Trap: explains that a pipe hides the exit code", ((contains(skill, "A pipe hides the exit code"))));
check("Trap: gives the correct command form", ((contains(skill, "rc=$?"))));
check("Trap: states the exit-code-preserving form", ((contains(skill, "Write `cmd > out.txt 2>&1; rc=$?` instead."))));
check("Trap: zero exit with zero tests is not a pass", ((contains(sub("\\s+", " ", skill), "zero exit code with zero tests collected is not a pass"))));
(got=md_rows(skill, "## Bulk edit safety", 2));
check("Bulk edit: action table matches the canonical rows", (isDeepStrictEqual(got,BULK_EDIT_TABLE)), (pyStr(got)));
check("Bulk edit: asserts exact count and intended scope before writing", ((contains(skill, "assert both the exact match count and the intended scope"))));
check("Bulk edit: stops on any out-of-scope match", ((value:any)=>truth(value)?value:((contains(skill, "stop if any match falls outside it"))))(((contains(skill, "stop if any match falls\noutside it")))));
check("Bulk edit: does not impose bulk procedure on one explicit edit", ((contains(skill, "One explicit occurrence does not need this bulk-edit ceremony"))));
(got=md_rows(skill, "## Conditional workflow completion", 2));
check("Conditional completion: evidence table matches canonical rows", (isDeepStrictEqual(got,CONDITIONAL_COMPLETION_TABLE)), (pyStr(got)));
check("Conditional completion: a change requires diff and fresh verification", ((contains(skill, "A useful change produces a diff and fresh verification"))));
check("Conditional completion: satisfied step requires fresh evidence and skip reason", ((value:any)=>truth(value)?value:((contains(skill, "keep the fresh verification evidence and state why that step was skipped"))))(((contains(skill, "keep the fresh\nverification evidence and state why that step was skipped")))));
check("Conditional completion: no diff and no skip reason is incomplete", ((value:any)=>truth(value)?value:((contains(skill, "A zero diff with an unexplained skipped step is incomplete"))))(((contains(skill, "A zero diff with an\nunexplained skipped step is incomplete")))));
check("Honesty: a nonexistent check cannot count as passing", ((contains(skill, "A check that does not exist is not a passing check"))));
check("Honesty: requires reporting checks that did not run", ((contains(skill, "say it did not run"))));
check("Honesty: explains that an omitted row reads as a pass", ((contains(skill, "An omitted row reads as a pass"))));
check("Merge: requires worktree check first", ((contains(skill, "/worktrees/"))));
check("Merge: verification precedes merge", ((contains(skill, "before the merge, not after"))));
check("Merge: forbids red merge and explains why", ((value:any)=>truth(value)?((contains(skill, "bisect"))):value)(((contains(skill, "Do not merge on a red check")))));
check("Merge: delegates commit format to gitrules", ((contains(skill, "`gitrules`"))));
check("Merge: needs the user's request and an approved squash, and a finished worktree or green check is not that request", ((contains(sub("\\s+", " ", skill), "Squash-merge a worktree only when the user asked for the merge")) && (contains(skill, "3. **Ask for approval.**")) && (contains(skill, "is not a request to merge"))));
check("Merge: the subject length is not restated here", (!contains(skill, "subject 50 chars")));
check("Verdict: INCONCLUSIVE is not a pass and a too-easy pass sends doubt to the observation method", ((contains(skill, "**VERIFIED**, **NOT VERIFIED**, or **INCONCLUSIVE**")) && (contains(sub("\\s+", " ", skill), "INCONCLUSIVE means the check could not answer the question")) && (contains(sub("\\s+", " ", skill), "It is not a pass")) && (contains(sub("\\s+", " ", skill), "test the observation method before trusting the result"))));
check("Gate: JS/TS diff coverage is lcov plus diff-cover at 90 and --changedSince is not the gate", ((contains(skill, "| JS/TS | `jest --coverage --coverageReporters=lcov && uvx diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=90`")) && (contains(skill, "never this gate"))));
check("Routing: PR review comments and flake questions go to the PR feedback reference", ((contains(skill, "[PR feedback](references/pr-feedback.md)"))));
(skills_dir=dirname(ROOT));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(skills_dir, n))))).map((n: any) => (n)));
check("Boundary: handoff target population is nonempty", (compare(length(named),3,">=")), (pyStr(sorted(named))));
check("Boundary: every handoff target exists", !truth(missing), ("missing " + pyStr(missing)));
check("Language: description has Korean triggers", ["검증", "PR 전 점검"].every(term => fm.includes(term)));
check("Language: description has English triggers", ((value:any)=>truth(value)?((contains(fm, "repeat-failing checks"))):value)(((contains(fm, "fresh evidence")))));
check("Gate: diff coverage section exists", ((contains(skill, "diff coverage"))));
check("Gate: explains how lowering disables an absolute threshold", ((value:any)=>truth(value)?((contains(skill, "lowering"))):value)(((contains(skill, "gets switched off")))));
check("Gate: leaves untouched legacy files outside the rule", ((contains(skill, "untouched legacy files are outside the rule"))));
check("Gate: table provides commands by language", ((value:any)=>truth(value)?((contains(skill, "diff-cover"))):value)(((contains(skill, "| Language | Diff coverage command |")))));
check("Gate: coverage is not proof and is paired with red_probe", ((value:any)=>truth(value)?((contains(skill, "scripts/red_probe.js"))):value)(((contains(skill, "Diff coverage is a floor, not a proof")))));
(owned=sorted([...readdirSync(join(ROOT,'references')).filter(n=>n.endsWith('.md')).map(n=>'references/'+n),...readdirSync(join(ROOT,'scripts')).filter(n=>n.endsWith('.js')).map(n=>'scripts/'+n)]));
(orphans=Array.from(owned).filter((rel: any) => truth(((!contains(skill, rel))))).map((rel: any) => (rel)));
check("References: no orphan references or scripts", !truth(orphans), ("orphans " + pyStr(orphans)));
check("References: owned-file table exists", ((contains(skill, "| File | Read or run it when |"))));
}
function main():any{
let ENV_DEPENDENT:any,_:any,_desc:any,_floor:any,_needles:any,flat:any,fm:any,fn:any,live_ran:any,ok:any,passed:any,r:any,skill:any,tmp:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
skill_prose_checks(fm, skill);
(flat=sub("\\s+", " ", skill));
check("Scope: affected checks are the default", ((contains(flat, "affected checks are the default scope"))));
check("Scope: does not run every repository check by default", ((value:any)=>truth(value)?((!contains(flat, "run every check the repository owns"))):value)(((contains(flat, "Do not run unrelated suites merely because the repository owns them")))));
check("Scope: shared contract expands to known consumer suites", ((contains(flat, "requires every consumer suite named by that contract"))));
check("Scope: release claim requires full package and release gates", ((contains(flat, "requires the full package and release gates"))));
check("Scope: report records selected scope and rationale", ((contains(flat, "Record which scope applied and why"))));
// These script checks build their own fixture trees and never read this skill's
// documents. A deletion copy that strips only documents therefore has identical
// inputs, and replays the live run's results; a copy that strips a script, or any
// other input change, runs them again. The author suite caches run_fixtures the same way.
const scriptDigest=scriptInputDigest([join(ROOT,'scripts'),join(ROOT,'tests'),join(dirname(SKILLS),'runtime'),join(dirname(SKILLS),'scripts')]);
const replayed=(()=>{if(!in_deleted_run())return null;try{const value=JSON.parse(process.env.JSTACK_VERIFY_SCRIPT_CHECKS??'null');return value?.digest===scriptDigest&&Array.isArray(value.results)?value.results as Result[]:null;}catch{return null;}})();
if(replayed){for(const [name,ok,detail] of replayed)check(name,ok,(detail?String(detail)+' ':'')+'(live-run result; same script inputs)');}
else{const scriptStart=results.length;
(tmp=temporaryDirectory());
try {preflight_checks(tmp);
preflight_hardening(tmp);
package_check_checks(tmp);
package_check_hardening(tmp);
red_probe_checks(tmp);
red_probe_hardening(tmp);
package_identity_checks(tmp);
test_speed_script_checks(tmp);}finally{removeTree(tmp, {ignore_errors: true});}
// The full workflow and timeout cases run in the integration lane. Quick
// contracts still check the prose, scripts, and their ordinary local behavior.
if (process.env.JSTACK_QUICK_CONTRACTS !== '1') workflow_checks();
if(!in_deleted_run())process.env.JSTACK_VERIFY_SCRIPT_CHECKS=JSON.stringify({digest:scriptDigest,results:results.slice(scriptStart)});}
check_skill_body(check, ROOT, {semantic: true, needles: SKILL_NEEDLES, floor: SKILL_FLOOR});
check_ref_contracts(check, ROOT, REF_CONTRACTS, { semantic: ["ship-gates.md"] });
for (let [fn, _desc, _needles, _floor] of REF_CONTRACTS) {
check_doc_order(("Reference contract: " + pyStr(fn) + " section order is preserved"), read(join(ROOT, "references", fn)), at(ANCHORS_OF, fn));
}
check("Provenance: NOTICE records adapted MIT sources, commits, and license texts", (()=>{let n='';try{n=readFileSync(join(ROOT, 'NOTICE'),'utf8');}catch{}return n.includes('hunkim/ai-is-fast-your-tests-are-slow')&&n.includes('9b076d08ffb5e6dd1e652b67984d533a6251810b')&&n.includes('Permission is hereby granted, free of charge')&&n.includes('tjboudreaux/cc-thinking-skills')&&n.includes('7b8fece345dfaa11773be7152ccd194589cb5437');})());
check("Routing: the slow suite procedure links every test speed reference and both scripts", (()=>{const v=read(join(ROOT, "references", "validation-cost.md"));return ["(test-waits.md)", "(test-parallelism.md)", "(test-selection.md)", "(flaky-tests.md)", "(test-evidence.md)", "scripts/test_profile.js", "scripts/test_smells.js"].every(n=>v.includes(n));})());
check("Routing: SKILL.md sends interactive terminal claims to the interactive CLI reference", read(join(ROOT, "SKILL.md")).includes("[interactive CLI checks](references/interactive-cli.md)"));
const selfCheck = read(join(ROOT, "references", "self-check.md"));
check("Extra review: unavailable reviewers leave review incomplete and cannot replace humans",
 selfCheck.includes("If delegation is unauthorized or the tool is unavailable, record that fact and leave the review incomplete.") &&
 selfCheck.includes("Never replace a required human review with a model review."));
(ENV_DEPENDENT=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
(live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ENV_DEPENDENT)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/preflight.js": PREFLIGHT_FLOOR, "scripts/package_check.js": PKGCHECK_FLOOR, "scripts/package_identity.js": PACKAGE_IDENTITY_FLOOR, "scripts/red_probe.js": REDPROBE_FLOOR, "scripts/workflow.js": WORKFLOW_FLOOR, "scripts/test_profile.js": TEST_PROFILE_FLOOR, "scripts/test_smells.js": TEST_SMELLS_FLOOR}, live_ran: live_ran});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": SKILL_MIN, "references/claim-labels.md": CLAIM_MIN, "references/digest-contract.md": DIGEST_MIN, "references/merge.md": MERGE_MIN, "references/self-check.md": SELF_CHECK_MIN, "references/local-feedback.md": 3, "references/validation-cost.md": 4, "references/test-waits.md": 4, "references/test-parallelism.md": 4, "references/test-selection.md": 4, "references/flaky-tests.md": 4, "references/test-evidence.md": 4, "references/interactive-cli.md": 4, "references/ci-diagnosis.md": 4, "references/pr-feedback.md": 4, "references/ship-gates.md": 2, "NOTICE": 1, "scripts/test_profile.js": TEST_PROFILE_FLOOR, "scripts/test_smells.js": TEST_SMELLS_FLOOR, "references/security-verification.md": 4, "references/defending-code-upstream.md": 4, "scripts/preflight.js": PREFLIGHT_FLOOR, "scripts/package_check.js": PKGCHECK_FLOOR, "scripts/package_identity.js": PACKAGE_IDENTITY_COVERAGE_FLOOR, "scripts/red_probe.js": REDPROBE_FLOOR, "scripts/workflow.js": WORKFLOW_FLOOR}, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: SKILL_MIN, live_ran: live_ran});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, TOTAL - (process.env.JSTACK_QUICK_CONTRACTS === '1' ? 3 : 0));
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
