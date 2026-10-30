/** Owning behavior and protocol contracts, with measured deletion controls. */
import {readFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {runProcess} from '../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

function rows(text:any,head:any,headers:any=["Split it", "Field"]):any{
let body:any,r:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", body)).filter((r: any) => truth(((!contains(headers, strip(r)))))).map((r: any) => (r));
}
function section(text:any,head:any):any{

if(truth(((!contains(text, head))))) {
return "";
}
return at(split(at(split(text, head, 1), 1), "\n## ", 1), 0);
}
function bullets(text:any,head:any):any{
let body:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
return findall("(?m)^- (.+)$", body);
}
function span(text:any,start:any,end:any=null):any{
let body:any;

if(truth(((!contains(text, start))))) {
return "";
}
(body=at(split(text, start, 1), 1));
if(truth(((value:any)=>truth(value)?((contains(body, end))):value)(end))) {
(body=at(split(body, end, 1), 0));
}
return body;
}
function xrows(text:any,start:any,end:any=null,headers:any=[]):any{
let r:any;

return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", span(text, start, end))).filter((r: any) => truth(((!contains(headers, strip(r)))))).map((r: any) => (r));
}
function pairs(text:any,start:any,end:any=null,headers:any=[]):any{
let c:any,cells:any,line:any,out:any;

(out=[]);
for (let line of lines(span(text, start, end))) {
(line=strip(line));
if(truth(((value:any)=>truth(value)?value:(compare(new Set(line),new Set("|-: "),"<=")))(!truth(starts(line, "|"))))) {
continue;
}
(cells=Array.from(split(strip(line, "|"), "|")).map((c: any) => (strip(c))));
if(truth(((value:any)=>truth(value)?((contains(headers, at(cells, 0)))):value)(cells))) {
continue;
}
out.push(cells);
}
return out;
}
function numbered(text:any,start:any,end:any=null):any{

return findall("(?m)^(\\d+)\\. \\*\\*(.+?)\\*\\*", span(text, start, end));
}
function main():any{
let ARCH:any,TA:any,TB:any,TC:any,_:any,adef:any,adef_h:any,adp:any,arch:any,b:any,bi:any,bm:any,both:any,briefs:any,cases:any,cflat:any,cl:any,cl_counts:any,cl_heads:any,cmb:any,codex:any,codex_fm:any,contract:any,eh:any,ex:any,excluded:any,exs:any,f:any,fb:any,fit:any,fl:any,fm:any,fm_bytes:any,follow:any,follow_words:any,fp2:any,frules:any,hyb:any,icv:any,k:any,kr_triggers:any,link:any,lost:any,missing:any,mtx:any,n:any,named:any,nots:any,nt:any,oflat:any,ok:any,ops:any,orphans:any,p:any,pa:any,pairs_am:any,passed:any,pb:any,pc:any,prc:any,pri:any,prin:any,proto:any,qa:any,qad:any,qad_h:any,r:any,refdir:any,refs_on_disk:any,rphase:any,rt:any,scn:any,sep:any,size:any,skill:any,steps:any,steps_blocks:any,sup:any,sup_steps:any,sva:any,t:any,tbl:any,term:any,toc:any,tpl:any,tree:any,trig:any,verbs:any,verifier:any,vtext:any,wb:any,wb_h:any,webtoon:any,wh:any,ws:any,x:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
([codex_fm, codex]=split_frontmatter(read(join(ROOT, "SKILL.codex.md"))));
(briefs=read(join(ROOT, "references", "briefs.md")));
(ops=read(join(ROOT, "references", "operations.md")));
(oflat=sub("\\s+", " ", sub("(?m)^>\\s?", "", ops)));
check("Codex: preserves the name and bilingual triggers", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(codex_fm, "parallel"))):value)((compare(length(findall("[가-힣]+", codex_fm)),5,">="))):value)(((contains(codex_fm, "name: team")))));
check("Codex: uses independent verification as the split criterion", ((contains(codex, "**independent to check**"))));
check("Codex: requires one writer per file or artifact", ((value:any)=>truth(value)?value:((contains(codex, "Never assign two writers to the same file or generated artifact"))))(((contains(codex, "Never assign two writers to\nthe same file or generated artifact")))));
check("Codex: preserves all five brief fields", (Array.from(["deliverable in one sentence", "exact output shape", "already been established", "outside the agent's ownership", "how the result will be checked"]).map((term: any) => (((contains(codex, term)))))).every((value:any)=>truth(value)));
check("Codex: withholds other reasoning and reference answers from independent executors", ((contains(codex, "must not receive another executor's reasoning or a reference answer"))));
check("Codex: follows live artifacts and fresh verification over reports", ((value:any)=>truth(value)?value:((contains(codex, "the artifact and fresh verification win"))))(((contains(codex, "the artifact and\nfresh verification win")))));
check("Codex: interruption recovery rereads repo, ref, status, diff, artifacts, and tests", (Array.from(["repository root", "exact ref", "status", "diff", "task artifacts", "test output"]).map((term: any) => (((contains(codex, term)))))).every((value:any)=>truth(value)));
check("Codex: recovered claims point to files, commits, artifacts, or fresh commands", ((contains(codex, "Every recovered claim points to a file, commit, artifact, or fresh command"))));
(excluded=new Set(findall("(?m)"+"^- `([^`]+\\.md)`$",codex)));
check("Codex: lists exactly three excluded Claude-only references", (isDeepStrictEqual(excluded,new Set(["agent-design-patterns.md", "orchestrator-template.md", "team-examples.md"]))), (repr(sorted(excluded))));
check("Codex: excludes Claude call syntax from parity accounting", ((value:any)=>truth(value)?((contains(codex, "not counted as Codex parity"))):value)(((contains(codex, "does not use Claude's task-call syntax, agent-role parameter")))));
check("Codex: creates a brief from the contract after v2 preflight", ((value:any)=>truth(value)?((contains(codex, "workflow.js\" brief <task-id>"))):value)(((contains(codex, "workflow.js\" preflight <task-id>")))));
check("Codex: does not treat a local brief as evidence of an agent call", ((contains(codex, "generated brief is local evidence, not an agent call"))));
check("Codex: skips the brief for small unnecessary delegation", ((contains(codex, "`위임: 불필요`, keep the small task local and skip the brief"))));
check("Codex: reviewer names and JSON receipts do not prove independence", ((value:any)=>truth(value)?value:((contains(codex, "does not prove independence from a reviewer name or JSON flag"))))(((contains(codex, "does not prove independence from a reviewer\nname or JSON flag")))));
check("decision: verification independence is the criterion", ((contains(skill, "**independent to check**"))));
check("decision: distinguishes independence to start", ((value:any)=>truth(value)?value:((contains(skill, "not merely independent to start"))))(((contains(skill, "not merely\nindependent to start")))));
check("decision: explains the cost of parallel edits to one module", ((contains(skill, "costs more than doing it once"))));
(tbl=rows(skill, "## When parallelism is the right shape"));
check("decision: split/do-not-split table has four rows", (isDeepStrictEqual(length(tbl),4)), (repr(length(tbl)) + " rows"));
check("decision: row names cover multi-file transforms, searches, perspectives, and sources", (isDeepStrictEqual(tbl,["The same transformation over many files", "Independent searches over different areas", "Several perspectives reviewing one artefact", "Gathering from many sources"])), (repr(tbl)));
check("decision: do-not-split column starts with mutually constrained design", ((contains(skill, "One design whose parts constrain each other"))));
check("decision: do-not-split column includes a change with its intent-locking tests", ((contains(skill, "A change and the tests that lock its intent"))));
check("decision: do-not-split column includes sequential work needing prior results", ((contains(skill, "each step needs the last step's result"))));
check("decision: do-not-split column includes synthesis of gathered material", ((contains(skill, "The synthesis of what was gathered"))));
check("decision: multi-perspective review has no merge problem", ((contains(skill, "no merge problem"))));
check("decision: explains that outputs are findings rather than edits", ((contains(skill, "findings rather than edits"))));
check("decision: identifies the common mistake of splitting synthesis", ((value:any)=>truth(value)?value:((contains(skill, "four partial conclusions"))))(((contains(skill, "four partial\nconclusions")))));
check("brief: states that a subagent cannot see this conversation", ((contains(skill, "does not see this conversation"))));
check("brief: says omissions produce confident errors rather than confusion", ((contains(skill, "confidently wrong rather than confused"))));
check("brief: enumerates four required items", (Array.from(["what to produce", "what shape the answer takes", "what is out of", "already been established"]).map((f: any) => (((contains(skill, f)))))).every((value:any)=>truth(value)));
check("brief: identifies already-established facts as the commonly dropped field", ((value:any)=>truth(value)?value:((contains(skill, "the one that gets dropped"))))(((contains(skill, "the one that gets\ndropped")))));
check("brief: says dropped facts are rediscovered differently", ((contains(skill, "sometimes differently"))));
check("brief: connects the v2 preflight and brief commands", ((value:any)=>truth(value)?((contains(skill, "workflow.js\" brief <task-id>"))):value)(((contains(skill, "workflow.js\" preflight <task-id>")))));
check("brief: carries requirement ID, behavior, ownership, positive, RED, and review fields", (Array.from(["requirement ID", "user behavior", "owned files", "positive command", "RED command", "selected review"]).map((term: any) => (((contains(skill, term)))))).every((value:any)=>truth(value)));
check("brief: permits native delegation only after preflight passes", ((value:any)=>truth(value)?((contains(skill, "harness's native delegation tool"))):value)(((contains(skill, "Only delegate after preflight passes")))));
check("brief: skips delegation and the brief for simple work", ((value:any)=>truth(value)?((contains(skill, "generating a brief would cost more"))):value)(((contains(skill, "`위임: 불필요` stays local")))));
(fl=rows(briefs, "## The fields"));
check("brief: field table has five rows", (isDeepStrictEqual(length(fl),5)), (repr(length(fl)) + " rows"));
check("brief: fields are deliverable, shape, established facts, scope, and verification", (isDeepStrictEqual(fl,["The deliverable, in one sentence", "The output shape", "Already established", "Explicitly out of scope", "How it will be checked"])), (repr(fl)));
check("brief: says missing deliverables cause exploration instead of production", ((contains(briefs, "An agent that explores instead of producing"))));
check("brief: says missing exclusions cause scope drift into neighboring work", ((contains(briefs, "Scope drift into the neighbouring agent's work"))));
check("brief: says missing verification makes the result unverifiable", ((contains(briefs, "cannot be verified when it comes back"))));
check("brief: explains why exclusions matter especially during concurrency", ((contains(briefs, "neither does the edge"))));
check("brief: says omitting established facts is not neutral", ((contains(briefs, "does not make the agent neutral"))));
check("brief: says omission creates two answers", ((contains(briefs, "now there are two answers"))));
check("independence: forbids showing agents one another's output", ((contains(skill, "do not let one see another's"))));
check("independence: says a second opinion after reading the first is a rewrite", ((contains(skill, "is a rewrite of the first"))));
check("independence: says three readers of one draft are one opinion counted three times", ((value:any)=>truth(value)?value:((contains(skill, "one opinion counted three times"))))(((contains(skill, "one opinion counted three\ntimes")))));
check("independence: requires synthesis only after all agents finish", ((contains(skill, "after all of them are done"))));
check("verification: treats a report as a claim rather than a result", ((contains(skill, "is a claim, not a result"))));
check("verification: requires checking testable claims before building on them", ((contains(skill, "check it before building on it"))));
check("verification: says agreement does not imply correctness", ((contains(skill, "not thereby correct"))));
check("verification: requires actual independence before agreement is evidence", ((contains(skill, "actually independent"))));
check("verification: requires evidence in reports", ((contains(briefs, "Ask for evidence in the report"))));
check("verification: says unsupported checked claims are indistinguishable from unchecked ones", ((contains(briefs, "cannot be distinguished from"))));
check("verification: runs workflow verify instead of copying success claims into state", ((contains(skill, "run the workflow's `verify` command rather than copying"))));
check("verification: record-review does not prove self-reported independence", ((value:any)=>truth(value)?value:((contains(skill, "does not turn a self-reported reviewer identity into proof of independence"))))(((contains(skill, "does not turn a self-reported reviewer identity into\nproof of independence")))));
(nots=findall("(?m)^- \\*\\*(.+?)\\*\\*", section(skill, "## What does not belong in a subagent")));
check("prohibition: section contains three nondelegable items", (isDeepStrictEqual(length(nots),3)), (repr(length(nots)) + " items"));
check("prohibition: says delegation buys nothing when judgment must be relearned", ((contains(skill, "delegating it buys nothing"))));
check("prohibition: says an unclear brief produces work that only looks finished", ((contains(skill, "now it looks finished"))));
check("prohibition: excludes work shorter than its brief", ((contains(skill, "shorter than its brief"))));
check("shape: requires the form that will be combined", ((contains(briefs, "the form you will combine"))));
check("shape: quantifies the cost of converting five prose reports", ((contains(briefs, "five chances to lose something"))));
check("shape: specifies what to report when nothing is found", ((contains(briefs, "what to say when the agent finds"))));
check("shape: says silence is indistinguishable from failure", ((contains(briefs, "indistinguishable from"))));
check("boundary: states the outcome of an unbounded brief", ((contains(briefs, "summarises what it happened to have read"))));
check("boundary: accepts any one of three finite boundaries", ((contains(briefs, "any one of the three"))));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("boundary: named-neighbor population is nonempty", (compare(length(named),2,">=")), (repr(sorted(named))));
check("boundary: every named neighbor exists", !truth(missing), ("missing " + repr(missing)));
check("boundary: consult, models, and author are named neighbors", (compare(new Set(["consult", "models", "author"]),named,"<=")), (repr(sorted(named))));
(kr_triggers=["\"병렬로\"", "\"동시에 여러\"", "\"서브에이전트\"", "\"에이전트 여러개\"", "\"팀으로\"", "\"나눠서 진행\"", "\"작업 분배\""]);
(lost=Array.from(kr_triggers).filter((t: any) => truth(((!contains(fm, t))))).map((t: any) => (t)));
check("language: description preserves all seven Korean triggers", !truth(lost), ("missing " + repr(lost)));
check("language: description also contains English triggers", ((value:any)=>truth(value)?((contains(fm, "fan out"))):value)(((contains(fm, "parallel")))));
check("language: trigger clause uses the literal marker", ((contains(fm, "Triggers —"))));
(fm_bytes=content_bytes(fm));
check("language: description identifies parallel work",fm.includes("parallel work"));
check("L0: description contains both split criteria and verification", ((value:any)=>truth(value)?((contains(fm, "verify what comes back"))):value)(((contains(fm, "checked separately")))));
(refdir=join(ROOT, "references"));
(refs_on_disk=sorted(Array.from(readdirSync(refdir)).filter((n: any) => truth(ends(n, ".md"))).map((n: any) => (n))));
(orphans=Array.from(refs_on_disk).filter((n: any) => truth(((!contains(skill, ("references/" + repr(n))))))).map((n: any) => (n)));
check("reachability: references/ population is nonempty", (compare(length(refs_on_disk),5,">=")), (repr(length(refs_on_disk)) + " files"));
check("reachability: every reference is reachable from the SKILL.md body", !truth(orphans), ("orphans " + repr(orphans)));
(contract=read(join(refdir, "orchestration-contract.md")));
check("cross-check: paired-contract section names quality-verifier", ((contains(contract, "## The paired contract: quality-verifier"))));
check("cross-check: section withholds executor reasoning from the verifier", ((contains(contract, "never the executor's reasoning"))));
(verifier=join(dirname(SKILLS), "agents", "quality-verifier.md"));
check("cross-check: quality-verifier.md exists", isfile(verifier), verifier);
(vtext=(truth(isfile(verifier)) ? read(verifier) : ""));
check("cross-check: quality-verifier.md itself rejects executor rationale", ((contains(joinText(" ", split(vtext)), "Do not receive the executor's rationale"))), "paired contract exists on one side only");
check("reference: SKILL.md cites the operations contract", ((contains(skill, "references/operations.md"))));
(mtx=rows(ops,"## Phase selection matrix",["Change"]));
check("operations: phase selection matrix has three rows", (isDeepStrictEqual(length(mtx),3)), (repr(length(mtx)) + " rows"));
check("operations: adding an agent reuses Phase 0 results for Phase 1", ((contains(ops, "| Add an agent | Skip; use Phase 0 results |"))));
check("operations: skill changes skip Phases 1-3 and require Phase 4", ((contains(ops, "| Add or modify a skill | Skip | Skip | Skip | Required |"))));
check("operations: architecture changes alone require Phase 2", ((contains(ops, "| Change architecture | Skip | Required |"))));
(size=rows(ops,"## Team size guidelines",["Workload"]));
check("operations: team-size table has three rows", (isDeepStrictEqual(length(size),3)), (repr(length(size)) + " rows"));
check("operations: small 5-10 task work uses 2-3 members with 3-5 tasks each", ((contains(ops, "| Small: 5–10 tasks | 2–3 | 3–5 |"))));
check("operations: medium 10-20 task work uses 3-5 members with 4-6 tasks each", ((contains(ops, "| Medium: 10–20 tasks | 3–5 | 4–6 |"))));
check("operations: large 20+ task work uses 5-7 members with 4-5 tasks each", ((contains(ops, "| Large: 20+ tasks | 5–7 | 4–5 |"))));
check("operations: includes the focused-three-over-distracted-five rule", ((contains(oflat, "Three focused members are better than five distracted members"))));
check("operations: attributes the rule to coordination overhead", ((contains(ops, "Coordination overhead grows with team size"))));
(proto=rows(ops,"## Data handoff protocol",["Strategy"]));
check("operations: data-handoff table has four rows", (isDeepStrictEqual(length(proto),4)), (repr(length(proto)) + " rows"));
check("operations: strategies are messages, tasks, files, and return values", (isDeepStrictEqual(proto,["**Messages**", "**Tasks**", "**Files**", "**Return values**"])), (repr(proto)));
check("operations: only files support both team and subagent modes", ((contains(ops, "| Read and write agreed paths | Team + subagents |"))));
check("operations: messages are team-only", ((contains(ops, "Direct member communication with `SendMessage` | Team |"))));
check("operations: return values are subagent-only", ((contains(ops, "Return message from the `Agent` tool | Subagents |"))));
check("operations: team mode recommends tasks, files, and messages", ((contains(oflat, "tasks for coordination + files for artifacts + messages for live communication"))));
check("operations: subagent mode recommends return values and files", ((contains(oflat, "return values for results + files for large artifacts"))));
check("operations: hybrid mode chooses the combination per phase", ((contains(oflat, "use the combination appropriate to each phase's execution mode"))));
(frules=bullets(ops, "## Data handoff protocol"));
check("operations: file handoff has three rules", (isDeepStrictEqual(length(frules),3)), (repr(length(frules)) + " items"));
check("operations: intermediate artifacts live under `_workspace/`", ((contains(ops, "Store intermediate artifacts in `_workspace/`"))));
check("operations: fixes the filename convention and example", ((contains(ops, "`{phase}_{agent}_{artifact}.{ext}`, for example `01_analyst_requirements.md`"))));
check("operations: preserves intermediate files for verification and audit", ((contains(oflat, "Preserve `_workspace/` intermediates for later verification and audit tracing"))));
(follow=bullets(ops, "## Detecting follow-up runs"));
check("operations: follow-up detection has three branches", (isDeepStrictEqual(length(follow),3)), (repr(length(follow)) + " branches"));
check("operations: existing output plus partial modification means partial rerun", ((contains(ops, "partial modification requested: **partial rerun**"))));
check("operations: existing output plus new input means new run and moves the workspace", ((value:any)=>truth(value)?((contains(ops, "`_workspace_prev/`"))):value)(((contains(ops, "new input supplied: **new run**")))));
check("operations: absent workspace means initial run", ((contains(ops, "`_workspace/` does not exist: **initial run**"))));
(fb=rows(ops,"## Where feedback belongs",["Feedback type"]));
check("operations: feedback-routing table has five rows", (isDeepStrictEqual(length(fb),5)), (repr(length(fb)) + " rows"));
check("operations: enumerates all five feedback types", (isDeepStrictEqual(fb,["Artifact quality", "Agent role", "Workflow order", "Team composition", "Missing trigger"])), (repr(fb)));
check("operations: artifact quality changes the agent's skill", ((contains(ops, "| Artifact quality | The agent's skill |"))));
check("operations: workflow order changes the orchestrator skill", ((contains(ops, "| Workflow order | Orchestrator skill |"))));
check("operations: missing triggers extend the skill description", ((contains(ops, "| Missing trigger | Skill description |"))));
(trig=bullets(ops, "## Evolution triggers"));
check("operations: evolution has three trigger conditions", (isDeepStrictEqual(length(trig),3)), (repr(length(trig)) + " conditions"));
check("operations: same feedback type recurring twice is a trigger", ((contains(ops, "same feedback type recurs at least twice"))));
check("operations: repeated failure pattern is a trigger", ((contains(ops, "repeatedly fails in the same pattern"))));
check("operations: user bypassing the orchestrator is a trigger", ((contains(ops, "user bypasses the orchestrator"))));
(steps=findall("(?m)^\\*\\*Step (\\d): ", ops));
check("operations: maintenance has four steps", (isDeepStrictEqual(steps,["1", "2", "3", "4"])), (repr(steps)));
check("operations: makes one change at a time and synchronizes immediately", ((value:any)=>truth(value)?((contains(ops, "immediately"))):value)(((contains(ops, "Make one change at a time")))));
check("operations: major-change threshold includes three or more agents", ((contains(ops, "adding/removing three or"))));
(adp=read(join(ROOT, "references", "agent-design-patterns.md")));
(tpl=read(join(ROOT, "references", "orchestrator-template.md")));
(qa=read(join(ROOT, "references", "qa-agent-guide.md")));
(ex=read(join(ROOT, "references", "team-examples.md")));
(ARCH="## Team architectures");
(arch=findall("(?m)^### (\\d)\\. (.+)$", span(adp, ARCH, "\n## Composite patterns")));
check("design: architecture section contains six types", (isDeepStrictEqual(length(arch),6)), (repr(length(arch)) + " types"));
check("design: six numbered types are pipeline, fan-out, expert pool, producer-reviewer, supervisor, hierarchy", (isDeepStrictEqual(arch,[["1", "Pipeline"], ["2", "Fan-out/Fan-in"], ["3", "Expert pool"], ["4", "Producer-Reviewer"], ["5", "Supervisor"], ["6", "Hierarchical delegation"]])), (repr(arch)));
(fit=findall("(?m)^\\*\\*Team suitability:\\*\\*", span(adp, ARCH, "\n## Composite patterns")));
check("design: all six types include a team-suitability verdict", (isDeepStrictEqual(length(fit),6)), (repr(length(fit)) + " verdicts"));
check("design: fan-out/fan-in requires an agent team", ((contains(adp, "**Use an agent team.**"))));
check("design: expert pools instead favor subagents", ((contains(adp, "subagents fit better because only needed experts run"))));
check("design: hierarchical delegation cites the no-nested-teams constraint", ((contains(adp, "teams cannot nest"))));
check("design: hierarchy depth is capped at two levels", ((value:any)=>truth(value)?value:((contains(adp, "Prefer at most two levels"))))(((contains(adp, "Prefer at\nmost two levels")))));
check("design: producer-reviewer retries are capped at 2-3", ((contains(adp, "maximum of 2–3 retries"))));
check("design: supervisor differs from fan-out by fixed versus dynamic assignment", ((value:any)=>truth(value)?value:((contains(adp, "fan-out fixes assignments in advance; a supervisor adjusts them according to progress"))))(((contains(adp, "fan-out fixes assignments in advance; a supervisor\nadjusts them according to progress")))));
check("design: teams are default and subagents require a communication check", ((value:any)=>truth(value)?((contains(adp, "communication between members is truly unnecessary"))):value)(((contains(adp, "agent teams are the default")))));
check("design: only one active team per session and teams cannot nest", ((value:any)=>truth(value)?((contains(adp, "Teams cannot nest"))):value)(((contains(adp, "Only one team may be **active** per session")))));
(tree=span(adp, "### Mode selection decision tree", "\n---"));
check("design: decision tree begins with at least two agents", ((contains(tree, "Are there at least two agents?"))));
check("design: communication leads to team, no communication to subagents, one agent to subagent", ((value:any)=>truth(value)?((contains(tree, "Do they need to communicate?"))):value)(truth(search("(?s)"+"Yes → Agent team \\(default\\).*No → Subagents are also suitable.*└── No → Subagent\\n",tree))));
(bi=pairs(adp,"### Built-in types","### Custom types",["Type"]));
check("design: built-in type table has three rows", (isDeepStrictEqual(length(bi),3)), (repr(length(bi)) + " rows"));
check("design: each built-in type binds to its tool access and use", (isDeepStrictEqual(bi,[["`general-purpose`", "All tools, including WebSearch and WebFetch", "Web research and general work"], ["`Explore`", "Read only; no Edit/Write", "Codebase exploration and analysis"], ["`Plan`", "Read only; no Edit/Write", "Architecture and planning"]])), (repr(bi)));
(sep=pairs(adp,"## Criteria for separating agents","## Skills versus agents",["Criterion"]));
check("design: separation-criteria table has four rows", (isDeepStrictEqual(length(sep),4)), (repr(length(sep)) + " rows"));
check("design: each criterion binds to its separate and combine values", (isDeepStrictEqual(sep,[["Expertise", "Different domains", "Overlapping domains"], ["Parallelism", "Independent execution possible", "Consider combining sequential dependencies"], ["Context", "High context burden", "Lightweight, quick work"], ["Reuse", "Useful in other teams", "Consider combining team-specific roles"]])), (repr(sep)));
(sva=pairs(adp,"## Skills versus agents","## Connecting skills and agents",["Aspect"]));
check("design: skill/agent comparison table has five rows", (isDeepStrictEqual(length(sva),5)), (repr(length(sva)) + " rows"));
check("design: each comparison axis binds skill and agent values", (isDeepStrictEqual(sva,[["Definition", "Procedural knowledge and tool bundle", "Expert persona and operating principles"], ["Location", "`.claude/skills/`", "`.claude/agents/`"], ["Activation", "User-request keyword matching", "Explicit invocation through Agent"], ["Size", "Small to large workflow", "Small role definition"], ["Purpose", "How to do the work", "Who does the work"]])), (repr(sva)));
(link=xrows(adp,"## Connecting skills and agents",undefined,["Method"]));
check("design: skill-connection table has three methods", (isDeepStrictEqual(length(link),3)), (repr(length(link)) + " methods"));
check("design: methods are Skill invocation, inline prompt, and reference loading", (isDeepStrictEqual(link,["**Skill tool invocation**", "**Inline prompt**", "**Reference loading**"])), (repr(link)));
check("design: inline method has a 50-line cap", ((contains(adp, "at most 50 lines"))));
(adef=span(adp, "## Agent definition structure", "## Criteria for separating agents"));
check("design: agent template requires name and description frontmatter", ((value:any)=>truth(value)?((contains(adef, "description: \"One or two sentences describing the role. List trigger keywords.\""))):value)(((contains(adef, "name: agent-name")))));
(adef_h=findall("(?m)^## (.+)$", adef));
check("design: definition template has six required sections in order", (isDeepStrictEqual(adef_h,["Core responsibilities", "Operating principles", "Input/output protocol", "Team communication protocol (agent team mode)", "Error handling", "Collaboration"])), (repr(adef_h)));
check("design: requires defining every agent in a file", ((contains(adp, "define every agent in `.claude/agents/{name}.md`"))));
check("design: chooses supported models by routing contract", ((contains(adp, "use the supported model selected by the `models` routing contract"))));
(cmb=xrows(adp,"## Composite patterns","### Execution modes for composite patterns",["Pattern"]));
check("design: composite-pattern table has three rows", (isDeepStrictEqual(length(cmb),3)), (repr(length(cmb)) + " rows"));
check("design: patterns are fan-out plus review, pipeline plus fan-out, and supervisor plus pool", (isDeepStrictEqual(cmb,["**Fan-out + producer-reviewer**", "**Pipeline + fan-out**", "**Supervisor + expert pool**"])), (repr(cmb)));
(scn=xrows(adp,"### Execution modes for composite patterns","## Selecting agent types",["Scenario"]));
check("design: four composite scenarios all select agent teams", ((value:any)=>truth(value)?(isDeepStrictEqual(count(span(adp, "### Execution modes for composite patterns", "## Selecting agent types"), "| Agent team |"),4)):value)((isDeepStrictEqual(length(scn),4))), (repr(length(scn)) + " rows"));
(TA=span(tpl, "## Template A:", "## Template B:"));
(TB=span(tpl, "## Template B:", "## Template C:"));
(TC=span(tpl, "## Template C:", "## Writing Principles"));
(pa=findall("(?m)^### Phase (\\d): (.+)$", TA));
check("template: A has six numbered phases from 0 through 5", (isDeepStrictEqual(pa,[["0", "Inspect Context (Support Follow-up Work)"], ["1", "Prepare"], ["2", "Create the Team"], ["3", "{Primary Work — for example, Research, Generation, or Analysis}"], ["4", "{Follow-up Work — for example, Validation or Integration}"], ["5", "Clean Up"]])), (repr(pa)));
(pb=findall("(?m)^### Phase (\\d): (.+)$", TB));
check("template: B has five numbered phases from 0 through 4", (isDeepStrictEqual(pb,[["0", "Inspect Context"], ["1", "Prepare"], ["2", "Run in Parallel"], ["3", "Integrate"], ["4", "Clean Up"]])), (repr(pb)));
(pc=findall("(?m)^### Phase (\\d): (.+)$", TC));
check("template: C demonstrates only Phases 2, 3, and 4", (isDeepStrictEqual(pc,[["2", "Parallel Data Collection"], ["3", "Consensus-based Integration"], ["4", "Independent Validation"]])), (repr(pc)));
(hyb=pairs(tpl,"## Execution Mode: Hybrid","### Phase 2:",["Phase"]));
check("template: hybrid phase/mode table has three rows", (isDeepStrictEqual(length(hyb),3)), (repr(length(hyb)) + " rows"));
check("template: each hybrid phase binds to mode and reason (subagent, team, subagent)", (isDeepStrictEqual(hyb,[["Phase 2 (parallel collection)", "Subagents", "Independent data collection; no team communication required"], ["Phase 3 (consensus integration)", "Agent team", "Conflicting data requires discussion and agreement"], ["Phase 4 (independent validation)", "Subagent", "One QA agent performs an objective validation"]])), (repr(hyb)));
check("template: C's phase table records subagent, team, subagent in order", (isDeepStrictEqual(Array.from(hyb).map((r: any) => (at(r, 1))),["Subagents", "Agent team", "Subagent"])), (repr(hyb)));
(eh=pairs(tpl,"## Error Handling","## Test Scenarios",["Situation"]));
check("template: A error-handling table has five rows", (isDeepStrictEqual(length(eh),5)), (repr(length(eh)) + " rows"));
check("template: five situations bind to their responses", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(at(at(eh, 3), 1), "do not delete either version"))):value)(((contains(at(at(eh, 3), 1), "Preserve both versions")))):value)((isDeepStrictEqual(Array.from(eh).map((r: any) => (at(r, 0))),["One teammate fails or stops", "A majority of teammates fail", "Timeout", "Data conflicts between teammates", "Task status is delayed"]))), (repr(Array.from(eh).map((r: any) => (at(r, 0))))));
(prin=numbered(tpl, "## Writing Principles", "## Follow-up Keywords"));
check("template: writing principles have seven items", (isDeepStrictEqual(length(prin),7)), (repr(length(prin)) + " items"));
check("template: seven principles are bound to their numbered order", (isDeepStrictEqual(prin,[["1", "State the execution mode first"], ["2", "In team mode, specify `TeamCreate`, `SendMessage`, and `TaskCreate` usage concretely"], ["3", "In subagent mode, specify every `Agent` tool parameter"], ["4", "Make file paths absolute"], ["5", "Declare dependencies between phases"], ["6", "Make error handling realistic"], ["7", "Test scenarios are required"]])), (repr(prin)));
check("template: enumerates five Agent parameters for subagent mode", (Array.from(["`name`", "`subagent_type`", "`prompt`", "`run_in_background: true`", "`model`"]).map((p: any) => (((contains(TB, p)))))).every((value:any)=>truth(value)));
check("template: includes at least one normal and one error test scenario", ((value:any)=>truth(value)?((contains(tpl, "### Error Flow"))):value)(((contains(tpl, "### Normal Flow")))));
check("template: hybrid transition rules cover team-to-subagent, subagent-to-team, and team-to-team", ((value:any)=>truth(value)?((contains(tpl, "Clean up the previous team"))):value)((Array.from(["Team → subagent:", "Subagent → team:", "Team → team:"]).map((x: any) => (((contains(tpl, x)))))).every((value:any)=>truth(value))));
(follow_words=["rerun", "update", "revise", "supplement", "repeat only part", "build on previous results", "improve the result"]);
check("template: follow-up language includes all seven trigger forms", (Array.from(follow_words).map((x: any) => (((contains(lower(tpl), x)))))).every((value:any)=>truth(value)), ("missing " + repr(Array.from(follow_words).filter((x: any) => truth(((!contains(lower(tpl), x))))).map((x: any) => (x)))));
check("template: missing follow-up triggers makes later selection difficult", ((contains(tpl, "effectively dead code after its first run"))));
check("template: recommends five or six tasks per teammate", ((contains(tpl, "Five to six tasks per teammate"))));
check("template: TeamCreate example includes team_name, members, agent_type, model, and prompt", (Array.from(["team_name: \"{domain}-team\"", "members: [", "agent_type: \"{type}\"", "model: \"{selected-model}\"", "prompt: \"{role description and work instructions}\""]).map((k: any) => (((contains(TA, k)))))).every((value:any)=>truth(value)));
check("template: TaskCreate example includes title, description, assignee, and depends_on", (Array.from(["TaskCreate(tasks: [", "title: \"{task-1}\"", "description: \"{details}\"", "assignee: \"{teammate-1}\"", "depends_on: [\"{task-1}\"]"]).map((k: any) => (((contains(TA, k)))))).every((value:any)=>truth(value)));
check("template: B parallel phase names model and run_in_background parameters", ((contains(TB, "specify `name`, `subagent_type`, `prompt`, `model`, and `run_in_background: true`"))));
check("template: cleanup preserves _workspace/ for verification and audit", ((value:any)=>truth(value)?((contains(tpl, "required for later verification and an audit trail"))):value)(((contains(tpl, "Preserve the `_workspace/` directory")))));
(toc=findall("(?m)^(\\d)\\. (.+)$", span(qa, "## Contents", "\n---")));
check("QA: contents list binds five numbered sections to their titles", (isDeepStrictEqual(toc,[["1", "Defect patterns QA agents miss"], ["2", "Integration coherence verification"], ["3", "QA agent design principles"], ["4", "Validation checklist template"], ["5", "QA agent definition template"]])), (repr(toc)));
(bm=xrows(qa,"### 1-1. Boundary Mismatch","### 1-2.",["Boundary"]));
check("QA: boundary-mismatch table has six rows", (isDeepStrictEqual(length(bm),6)), (repr(length(bm)) + " rows"));
check("QA: six boundaries cover response-to-hook, field-to-type, path-to-href, transition-to-update, endpoint-to-hook, and immediate-to-async", (isDeepStrictEqual(bm,["API response → frontend hook", "API response field name → type definition", "File path → link href", "State-transition map → actual status update", "API endpoint → frontend hook", "Immediate response → asynchronous result"])), (repr(bm)));
check("QA: three static-review blind spots are generics, successful builds, and existence checks", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(qa, "**Existence checks and connection checks are different:**"))):value)(((contains(qa, "**`npm run build` passing does not mean the behavior works:**")))):value)(((contains(qa, "**Limit of TypeScript generics:**")))));
(icv=span(qa, "## 2. Integration Coherence Verification", "## 3. QA Agent Design Principles"));
(steps_blocks=Array.from(findall("(?s)"+"Validation steps:\\n(.*?)\\n```",icv)).map((b: any) => (findall("(?m)^(\\d)\\. (.+)$", b))));
check("QA: all four integration sections contain a Validation steps procedure", (isDeepStrictEqual(length(steps_blocks),4)), (repr(length(steps_blocks)) + " procedures"));
check("QA: the four procedures contain 4, 4, 5, and 4 steps", (isDeepStrictEqual(Array.from(steps_blocks).map((b: any) => (length(b))),[4, 4, 5, 4])), (repr(Array.from(steps_blocks).map((b: any) => (length(b))))));
(verbs=Array.from(steps_blocks).map((b: any) => (Array.from(b).map(([_, t]: any) => (at(split(t), 0))))));
check("QA: every procedure step remains bound to its action verb", (isDeepStrictEqual(verbs,[["Extract", "Inspect", "Compare", "Check"], ["Derive", "Collect", "Confirm", "Pay"], ["Extract", "Search", "Confirm", "Identify", "Confirm"], ["List", "List", "Identify", "Determine"]])), (repr(verbs)));
check("QA: state-transition tracing includes dead-transition identification as a step", ((contains(qa, "Identify transitions declared in the map that no code executes (dead transitions)."))));
(prc=findall("(?m)^### 3-(\\d)\\. (.+)$", qa));
check("QA: four design principles remain bound to their numbers", (isDeepStrictEqual(prc,[["1", "Use `general-purpose`, Not the `Explore` Type"], ["2", "Prefer Cross-comparison Checks Over Existence Checks"], ["3", "The \"Read Both Sides Together\" Principle"], ["4", "Run QA Immediately After Each Module, Not Only After the Build"]])), (repr(prc)));
(ws=pairs(qa,"### 3-2.","### 3-3.",["Weak checklist item"]));
check("QA: weak/strong checklist comparison has four rows", (isDeepStrictEqual(length(ws),4)), (repr(length(ws)) + " rows"));
check("QA: each weak question remains bound to its stronger cross-check", (isDeepStrictEqual(ws,[["Does the API endpoint exist?", "Does the API endpoint's response shape match the corresponding hook's type?"], ["Is a state-transition map defined?", "Does every status update in the code agree with a transition in the map?"], ["Does the page file exist?", "Does every link in the code point to a page that actually exists?"], ["Is TypeScript strict mode enabled?", "Is any type safety bypassed through generic casts?"]])), (repr(ws)));
check("QA: incremental QA is fixed as the recommended pattern", ((contains(qa, "As soon as each backend API is complete, cross-check that API and its corresponding hook (incremental QA)."))));
(cl=span(qa, "## 4. Validation Checklist Template", "## 5. QA Agent Definition Template"));
(cl_heads=findall("(?m)^#### (.+)$", cl));
check("QA: checklist is divided into four areas", (isDeepStrictEqual(cl_heads,["API ↔ Frontend Connection", "Routing Coherence", "State-machine Coherence", "Data-flow Coherence"])), (repr(cl_heads)));
(cl_counts=Array.from(slice(regexSplit("(?m)^#### .+$",cl), 1)).map((b: any) => (length(findall("(?m)^- \\[ \\] ", b)))));
check("QA: checklist counts are 5, 3, 4, and 3 for a total of 15", ((value:any)=>truth(value)?(isDeepStrictEqual((cl_counts).reduce((total:number,value:any)=>total+Number(value),0),15)):value)((isDeepStrictEqual(cl_counts,[5, 3, 4, 3]))), (repr(cl_counts)));
check("QA: response unwrapping and the 202/final-result distinction remain checklist items", ((value:any)=>truth(value)?((contains(qa, "- [ ] The frontend distinguishes the shape of an immediate response (`202`) from the final result."))):value)(((contains(qa, "- [ ] When a response is wrapped, such as `{ items: [...] }`, the hook unwraps it.")))));
(qad=span(qa, "## 5. QA Agent Definition Template", "## Real Failures Found in SatangSlide"));
check("QA: definition template has name qa-inspector and a description value", ((value:any)=>truth(value)?((contains(qad, "description: \"A QA validation specialist. Validates specification compliance, integration coherence, and design quality.\""))):value)(((contains(qad, "name: qa-inspector")))));
(qad_h=findall("(?m)^## (.+)$", qad));
check("QA: definition template contains responsibility, priority, method, and communication sections", (isDeepStrictEqual(qad_h,["Core Responsibility", "Validation Priority", "Validation Method: \"Read Both Sides Together\"", "Team Communication Protocol"])), (repr(qad_h)));
(pri=numbered(qad, "## Validation Priority", "## Validation Method"));
check("QA: four validation priorities remain numbered with integration coherence first", (isDeepStrictEqual(pri,[["1", "Integration coherence"], ["2", "Functional specification compliance"], ["3", "Design quality"], ["4", "Code quality"]])), (repr(pri)));
(both=pairs(qad,"## Validation Method: \"Read Both Sides Together\"","## Team Communication Protocol",["Validation target"]));
check("QA: read-both-sides table has four rows", (isDeepStrictEqual(length(both),4)), (repr(length(both)) + " rows"));
check("QA: each producer remains bound to its consumer", (isDeepStrictEqual(both,[["API response shape", "`NextResponse.json()` in route.ts", "`fetchJson<T>` in hooks/"], ["Routing", "Page-file paths under src/app/", "`href` and `router.push` values"], ["State transitions", "`STATE_TRANSITIONS` map", "`.update({ status })` code"], ["Database → API → UI", "Table column names", "API response fields → type definitions"]])), (repr(both)));
check("QA: boundary issues must be reported to the agents on both sides", ((contains(qad, "For a boundary defect, notify the agents responsible for **both** sides."))));
(cases=xrows(qa,"## Real Failures Found in SatangSlide",undefined,["Defect"]));
check("QA: real-failure table has seven rows", (isDeepStrictEqual(length(cases),7)), (repr(length(cases)) + " rows"));
check("QA: cases retain concrete filter, failedIndices, and thumbnail symptoms", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(qa, "`thumbnailUrl` vs `thumbnail_url`"))):value)(((contains(qa, "`data.failedIndices`")))):value)(((contains(qa, "`projects?.filter is not a function`")))));
(exs=findall("(?m)^## Example (\\d): (.+)$", ex));
check("examples: five examples are bound to their numbers", (isDeepStrictEqual(exs,[["1", "Research Team"], ["2", "Science-fiction Writing Team"], ["3", "Webtoon Production"], ["4", "Code Review Team"], ["5", "Supervisor Pattern for Code Migration"]])), (repr(exs)));
(pairs_am=findall("(?m)^\\*\\*Architecture:\\*\\* (.+?)\\. \\*\\*Mode:\\*\\* (.+?)\\.$", ex));
check("examples: each architecture is bound to its execution mode", (isDeepStrictEqual(pairs_am,[["fan-out/fan-in", "agent team"], ["pipeline plus fan-out", "agent team for collaborative phases and subagents for individual phases"], ["generate and verify", "subagents"], ["fan-out/fan-in plus discussion", "agent team"], ["supervisor", "agent team"]])), (repr(pairs_am)));
(rt=pairs(ex,"| Teammate | Agent type | Role | Output |","Define every research agent",["Teammate"]));
check("examples: research-team roster has five rows", (isDeepStrictEqual(length(rt),5)), (repr(length(rt)) + " rows"));
check("examples: four researchers and the leader bind to their output files", ((value:any)=>truth(value)?(isDeepStrictEqual(Array.from(rt).map((r: any) => (at(r, -(1)))),["research_official.md", "research_media.md", "research_community.md", "research_background.md", "consolidated-report.md"])):value)((isDeepStrictEqual(Array.from(rt).map((r: any) => (at(r, 0))),["official-researcher", "media-researcher", "community-researcher", "background-researcher", "Leader/orchestrator"]))), (repr(Array.from(rt).map((r: any) => (at(r, 0))))));
(rphase=findall("(?m)^Phase (\\d): (.+)$", span(ex, "## Example 1:", "## Example 2:")));
check("examples: research workflow binds Phases 1 through 5 to their names", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(ex, "preserve both sourced versions"))):value)(((contains(ex, "sends newly discovered official statistics to the media")))):value)((isDeepStrictEqual(rphase,[["1", "Preparation"], ["2", "Team creation"], ["3", "Research"], ["4", "Consolidation"], ["5", "Cleanup"]]))), (repr(rphase)));
(nt=xrows(ex,"## Example 2:","## Example 3:",["Teammate"]));
check("examples: writing team has six members", (isDeepStrictEqual(length(nt),6)), (repr(length(nt)) + " members"));
check("examples: six members cover world, character, plot, prose, science, and continuity", (isDeepStrictEqual(nt,["worldbuilder", "character-designer", "plot-architect", "prose-stylist", "science-consultant", "continuity-manager"])), (repr(nt)));
(wb=span(ex, "### Full agent example: `worldbuilder.md`", "### Detailed team workflow"));
check("examples: worldbuilder definition has name and description values", ((value:any)=>truth(value)?((contains(wb, "description: \"Designs science-fiction worlds, including physical laws, social structures, technology, and history.\""))):value)(((contains(wb, "name: worldbuilder")))));
(wb_h=findall("(?m)^## (.+)$", wb));
check("examples: worldbuilder definition has six required sections in order", (isDeepStrictEqual(wb_h,["Core responsibilities", "Working principles", "Input and output protocol", "Team communication protocol", "Error handling", "Collaboration"])), (repr(wb_h)));
check("examples: worldbuilder output path is _workspace/01_worldbuilder_setting.md", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(ex, "Write _workspace/02_prose_draft.md"))):value)(((contains(ex, "Read all three Phase 1 artifacts from _workspace/")))):value)(((contains(wb, "- Output: `_workspace/01_worldbuilder_setting.md`")))));
(webtoon=span(ex, "## Example 3:", "## Example 4:"));
check("examples: webtoon-reviewer binds to its role and two skills", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(webtoon, "Output: `_workspace/review_report.md`"))):value)(((contains(webtoon, "Input: panel images under `_workspace/panels/`")))):value)(((contains(webtoon, "description: \"Reviews webtoon panels")))):value)(((contains(webtoon, "name: webtoon-reviewer")))):value)(((contains(webtoon, "| webtoon-reviewer | custom | Review quality | review-webtoon, fix-webtoon-panel |")))));
check("examples: decisions are PASS/FIX/REDO and distinguish partial edits from regeneration", ((value:any)=>truth(value)?((contains(webtoon, "Use `FIX` when a partial edit is sufficient and `REDO` when full regeneration is required"))):value)(((contains(webtoon, "returns `PASS`, `FIX`, or `REDO`")))));
check("examples: retries stop after two loops and then pass with a warning", ((value:any)=>truth(value)?((contains(webtoon, "pass the panel with a warning"))):value)(((contains(webtoon, "at most two loops")))));
check("examples: a REDO majority triggers a prompt-revision suggestion", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(webtoon, "Review regenerated panels again, for at most two loops"))):value)(((contains(webtoon, "Deliver file-based correction instructions to webtoon-artist")))):value)(((contains(webtoon, "suggest revising the generation prompt")))):value)(((contains(webtoon, "at least half of all panels receive `REDO`")))));
check("examples: code review team includes security, performance, and test reviewers", (Array.from(["security", "performance", "test"]).map((n: any) => (((contains(span(ex, "## Example 4:", "## Example 5:"), (repr(n) + "-reviewer"))))))).every((value:any)=>truth(value)));
check("examples: reviewers communicate directly across specialties", ((contains(ex, "Reviewers communicate directly to catch issues that cross specialties"))));
(sup=span(ex, "## Example 5:", "## Deliverable Patterns"));
(sup_steps=findall("(?m)^(\\d)\\. (.+)$", sup));
check("examples: supervisor allocation retains all six numbered workflow steps", ((value:any)=>truth(value)?(isDeepStrictEqual(Array.from(sup_steps).map(([n, _]: any) => (n)),Array.from("123456"))):value)((isDeepStrictEqual(length(sup_steps),6))), (repr(sup_steps)));
check("examples: supervisor steps preserve collection-to-reassignment order", (Array.from(["Collect the complete target-file list", "Estimate complexity from file size, import count, and dependencies", "Register file batches and dependencies as tasks with `TaskCreate`", "Let teammates claim available work", "ask for the cause with `SendMessage`", "leader run integration tests"]).map((x: any) => (((contains(sup, x)))))).every((value:any)=>truth(value)));
check("examples: supervisor differs from fixed fan-out through dynamic runtime assignment", ((contains(sup, "Unlike a fixed fan-out, this pattern assigns work dynamically at runtime"))));
check("examples: agent definitions enumerate five required sections", ((contains(ex, "includes core responsibilities, working principles, input/output protocol, error handling, and collaboration"))));
check("examples: team mode additionally requires a communication protocol", ((value:any)=>truth(value)?((contains(ex, "incoming and outgoing messages"))):value)(((contains(ex, "Team-mode definitions also include a **team communication protocol**")))));
(wh=numbered(contract, "## What \"does not receive\" excludes", "## Why this is a constraint"));
check("contract: two withheld inputs are bound to their numbered order", (isDeepStrictEqual(wh,[["1", "The original."], ["2", "Your carve reasoning."]])), (repr(wh)));
(cflat=sub("\\s+", " ", contract));
check("contract: handing over the original defeats carving", ((contains(cflat, "Handing over the original alongside the carved prompt defeats the carving"))));
check("contract: a boundary is defined by what actually crosses it", ((contains(cflat, "a boundary is set by what crosses it, not by what could"))));
check("contract: an original plus a carved prompt is only an original plus a suggestion", ((contains(contract, "it has the original, plus a suggestion"))));
check("contract: the information cut applies toward executor and verifier", ((contains(cflat, "does not cross that step's boundary in either direction"))));
check("contract: verifier receives artifact and original but not executor reasoning", ((contains(cflat, "the verifier receives the artifact and the original"))));
check("contract: cites four brief fields and excludes carve reasoning from them", ((value:any)=>truth(value)?((contains(cflat, "None of those fields is \"why I decided this is the task\""))):value)(((contains(cflat, "the deliverable, the output shape, what is out of scope, and what has already been established")))));
check("contract: carries the conclusion without its source or reasoning path", ((contains(cflat, "carry the conclusion into the brief — not the source, and not the path you took to reach it"))));
(fp2=pairs(briefs,"## The fields","## Say what is settled",["Field"]));
check("briefs: five fields bind row-by-row to the failures they prevent", (isDeepStrictEqual(fp2,[["The deliverable, in one sentence", "An agent that explores instead of producing"], ["The output shape", "A report you have to re-read to extract anything from"], ["Already established", "Rediscovery, and rediscovery that lands somewhere different"], ["Explicitly out of scope", "Scope drift into the neighbouring agent's work"], ["How it will be checked", "Work that cannot be verified when it comes back"]])), (repr(fp2)));
check("operations: phases define all six harness-building stages", ((value:any)=>truth(value)?((contains(oflat, "Phase 0 audits the current state and always comes first"))):value)(((contains(oflat, "1 domain analysis, 2 team architecture, 3 agent definitions, 4 skills, 5 integration and orchestration, 6 validation and testing")))));
check("operations: phase matrix has columns for Phases 1 through 6", ((contains(ops, "| Change | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |"))));
check("operations: agent-role feedback changes the agent definition", ((contains(ops, "| Agent role | Agent definition `.md` | \"Security review is needed\": add an agent |"))));
check("operations: team-composition feedback changes orchestrator and agents", ((contains(ops, "| Team composition | Orchestrator + agents | \"These two can be combined\": merge agents |"))));
check("operations: task lower and upper bounds explain briefing cost and bottlenecks", ((contains(oflat, "Below three tasks per member, briefing costs more than execution; above six, one member becomes a bottleneck"))));
check("operations: follow-up detection uses workspace existence and request type", ((value:any)=>truth(value)?((contains(oflat, "request type alone may try to read nonexistent artifacts on an initial run"))):value)(((contains(ops, "Both dimensions matter")))));
check("operations: moving old results preserves comparison", ((contains(oflat, "Move existing results instead of overwriting them so the previous version remains available for comparison"))));
check("operations: timestamp suffix implements the same archival rule", ((contains(oflat, "implements the same rule with a timestamp suffix, `_workspace_{YYYYMMDD_HHMMSS}/`"))));
check("operations: follow-up activation requires description keywords and recall instructions", ((value:any)=>truth(value)?((contains(ops, "**Include recall instructions in agent definitions:**"))):value)(((contains(ops, "**Include follow-up keywords in the orchestrator description:**")))));
check("operations: skipping Step 3 creates a mismatch at the next audit", ((contains(oflat, "Skipping Step 3 after a modification creates a mismatch in the next audit"))));
const skillFlat=sub("\\s+"," ",skill),briefsFlat=sub("\\s+"," ",briefs),codexFlat=sub("\\s+"," ",codex);
check("delegation: runs one unit end to end before fanning out", ((contains(skillFlat, "finish one piece end to end first"))));
check("delegation: writes the scoring rubric before competing candidates start", ((contains(skillFlat, "write the scoring rubric before any of them starts"))));
check("delegation: every started worker ends done, replaced, or absorbed", ((contains(skillFlat, "done, replaced, or absorbed"))));
check("delegation: judges a quiet worker by side effects, not status text", ((contains(skillFlat, "judged by its side effects"))));
check("delegation: a slice with no result is a gap, not a pass", ((contains(skillFlat, "is a gap, not a pass"))));
check("delegation: never continues with N-1 for a required review", ((contains(skillFlat, "Never continue with N-1 results when the review was required"))));
check("delegation: a writing worker gets its own worktree or branch", ((contains(skillFlat, "gets its own worktree or branch"))));
check("brief: asks for a PASS, ISSUES or BLOCKED verdict backed by evidence", ((contains(briefsFlat, "`PASS`, `ISSUES` or `BLOCKED`"))));
check("brief: an ISSUES worker lists every defect it can prove", ((contains(briefsFlat, "lists every defect it can prove"))));
check("brief: a writing worker gets its own worktree or branch", ((contains(briefsFlat, "gets its own worktree or branch"))));
check("Codex: one unit first, gap handling, rubric first, and writer isolation", (Array.from(["finish one piece end to end", "is a gap, not a pass", "Never continue with N-1 results", "own worktree or branch", "scoring rubric"]).map((term: any) => (((contains(codexFlat, term)))))).every((value:any)=>truth(value)));
check_skill_body(check, ROOT, {semantic: true, needles: ["**independent to check**", "does not see this conversation", "do not let one see another's", "is a claim, not a result", "no merge problem", "references/operations.md"], floor: 4100});
check_ref_contracts(check, ROOT, [["briefs.md", "field table, settled facts, output shape, exploration bounds, and evidence", ["neither does the edge", "now there are two answers", "the form you will combine", "Ask for evidence in the report", "State whether the agent starts fresh or inherits a fork", "Do not spawn other agents", "including the coordinator", "Independent reviewers do not see one another"], 1522], ["agent-design-patterns.md", "team and subagent modes, six architectures, and separation criteria", ["Execution modes: agent teams and subagents", "Mode selection decision tree", "Skills versus agents"], 8941], ["orchestrator-template.md", "three orchestrator templates for team, subagent, and hybrid modes", ["Template A: Agent Team", "Template B: Subagent Mode", "Template C: Hybrid"], 9455], ["qa-agent-guide.md", "boundary mismatches, integration coherence, and QA design principles", ["Defect Patterns QA Agents Miss", "Integration Coherence Verification", "As soon as each backend API is complete, cross-check that API and its corresponding hook"], 8558], ["team-examples.md", "five examples for research, writing, webtoon, code review, and supervision", ["Example 1: Research Team", "Example 4: Code Review Team", "Supervisor Pattern for Code Migration"], 8922], ["orchestration-contract.md", "information-cut constraint and its paired quality-verifier contract", ["carved prompt", "never the executor's reasoning", "anchor on the executor's claim"], 2365], ["operations.md", "team sizes, four handoffs, three follow-ups, five feedback paths, three evolution triggers, and four steps", ["Three focused members are better", "| Large: 20+ tasks | 5–7 | 4–5 |", "Preserve\n  `_workspace/` intermediates for later verification and audit tracing", "move the old workspace to `_workspace_prev/`", "adding/removing three or\n  more agents"], 5413]]);
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 52, "SKILL.codex.md": 15, "references/briefs.md": 23, "references/agent-design-patterns.md": 32, "references/orchestrator-template.md": 23, "references/qa-agent-guide.md": 26, "references/team-examples.md": 24, "references/orchestration-contract.md": 13, "references/operations.md": 51}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 52, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 278);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
