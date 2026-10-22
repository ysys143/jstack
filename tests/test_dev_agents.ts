/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../skills/_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../skills/_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=join(ROOT,"skills"),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function escapeRegex(text:string):string{return text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const AG=join(ROOT, "agents");
const WANT=["quality-auditor", "quality-executor", "quality-verifier", "sag-automation-scout", "sag-doc-updater", "sag-duplicate-checker", "sag-followup-suggester", "sag-learning-extractor"];
function main():any{
let _:any,_ran:any,all_names:any,b:any,bodies:any,body:any,d:any,f:any,fm:any,fms:any,m:any,n:any,named:any,names:any,ok:any,on_disk:any,passed:any,r:any,tax:any,w:any;
(all_names=sorted(Array.from(readdirSync(AG)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (slice(f, 0, -(3))))));
check("Inventory: the unified agent count is 17", (isDeepStrictEqual(length(all_names),17)), (pyStr(all_names)));
(names=sorted(WANT));
for (let w of WANT) {
check(("Inventory: " + pyStr(w) + " is present"), ((contains(names, w))));
}
([fms,bodies]=[{}, {}]);
for (let n of names) {
([fm,body]=split_frontmatter(read(join(AG, (n + ".md")))));
([fms[n],bodies[n]]=[fm, body]);
check(("Format: " + pyStr(n) + " name matches its filename"), truth(search(("(?m)^name:\\s*" + pyStr(escapeRegex(n)) + "\\s*$"), fm)));
check(("Format: " + pyStr(n) + " has a description"), truth(search("(?m)^description:\\s*\\S", fm)));
check(("Format: " + pyStr(n) + " declares a model (no hidden inheritance)"), truth(search("(?m)^model:\\s*(haiku|sonnet|opus)\\s*$", fm)));
check(("Body: " + pyStr(n) + " contains procedure or judgment"), (compare(length(strip(body)),500,">")), (pyStr(length(strip(body))) + "B"));
check(("Restraint: " + pyStr(n) + " accepts no output as a valid result"), ((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:((contains(at(bodies, n), "zero is correct"))))(((contains(at(bodies, n), "**Report none**")))))(((contains(at(bodies, n), "label unverified claims as\nunverified")))))(((contains(at(bodies, n), "report that without editing")))))(((contains(at(bodies, n), "yield no learning")))))(((contains(at(bodies, n), "Report none if nothing remains")))))(((contains(at(bodies, n), "Report none when appropriate")))))(((contains(at(bodies, n), "Report no findings when there are none")))));
}
check("Separation: auditor does not fix", ((contains(at(bodies, "quality-auditor"), "Do not fix anything"))));
check("Separation: auditor explains why edits go unjudged", ((contains(at(bodies, "quality-auditor"), "nobody judges that edit"))));
check("Separation: executor stays within reported scope", ((contains(at(bodies, "quality-executor"), "Fix only reported issues"))));
check("Separation: executor rejects rewriting a module for one finding", ((contains(at(bodies, "quality-executor"), "one-line finding"))));
check("Separation: verifier does not fix", ((contains(at(bodies, "quality-verifier"), "Do not fix issues"))));
check("Separation: verifier rejects unverified passing signals", ((contains(at(bodies, "quality-verifier"), "passing signal without verification"))));
check("Separation: duplicate-checker creates no suggestions", ((contains(at(bodies, "sag-duplicate-checker"), "Do not create new suggestions"))));
check("Separation: duplicate suggestions have no verifier", ((contains(at(bodies, "sag-duplicate-checker"), "no verifier"))));
check("Canonical: auditor names quality-taxonomy", ((contains(at(bodies, "quality-auditor"), "skills/cleanup/references/quality-taxonomy.md"))));
check("Canonical: auditor forbids copies", ((contains(at(bodies, "quality-auditor"), "Do not create a copy"))));
(tax=join(SKILLS, "cleanup", "references", "quality-taxonomy.md"));
check("Canonical: the source exists", isfile(tax));
check("Judgment: auditor's default verdict is blocked", ((contains(at(bodies, "quality-auditor"), "The default verdict is **blocked**"))));
check("Judgment: reversing the burden resembles inspecting nothing", ((contains(at(bodies, "quality-auditor"), "indistinguishable from inspecting\nnothing"))));
check("Judgment: auditor reports unchecked scope", ((contains(at(bodies, "quality-auditor"), "Say what you did not inspect"))));
check("Review termination: auditor keeps stable IDs and focuses correction follow-ups", contains(at(bodies, "quality-auditor"), "Keep finding IDs stable") && contains(at(bodies, "quality-auditor"), "reported defects") && contains(at(bodies, "quality-auditor"), "evidence before reopening"));
check("Judgment: silence does not mean checked and fine", ((contains(at(bodies, "quality-auditor"), "checked and fine"))));
check("Verification: fewer checks are not a pass", ((contains(at(bodies, "quality-verifier"), "fewer checks is not a pass"))));
check("Verification: vanished checks do not fail", ((contains(at(bodies, "quality-verifier"), "target disappears"))));
check("Verification: zero passing checks are not a pass", ((contains(at(bodies, "quality-verifier"), "Zero passing checks is not a pass"))));
check("Verification: the procedure has four steps", (isDeepStrictEqual(length(findall("(?m)^\\d\\. \\*\\*", at(bodies, "quality-verifier"))),4)));
check("Verification: it reuses only evidence bound to matching inputs and environment", ((contains(at(bodies, "quality-verifier"), "inputs")) && contains(at(bodies, "quality-verifier"), "relevant environment still match")));
check("Verification: it requires reading more than the exit code", ((contains(at(bodies, "quality-verifier"), "do not inspect only the exit code"))));
check("Lock: executor gives three preconditions", ((contains(at(bodies, "quality-executor"), "directly observed tests passing"))));
check("Lock: executor stops when the lock is unavailable", ((contains(at(bodies, "quality-executor"), "stop"))));
check("Lock: axis order puts swallowed exceptions first", ((contains(at(bodies, "quality-executor"), "before"))));
check("Lock: executor reverts a failed pass instead of patching forward", ((contains(at(bodies, "quality-executor"), "revert that pass"))));
check("Lock: deleting tests is not a fix", ((contains(at(bodies, "quality-executor"), "Deleting tests to make them green is not a fix"))));
check("Judgment: doc-updater selects only what code cannot state", ((contains(at(bodies, "sag-doc-updater"), "what code cannot explain itself"))));
check("Judgment: doc-updater requires a file and section", ((contains(at(bodies, "sag-doc-updater"), "target file and section"))));
check("Judgment: automation-scout compares identical decisions, not counts", ((contains(at(bodies, "sag-automation-scout"), "same decision each time"))));
check("Judgment: automation-scout gives four forms", (Array.from(["Script", "Command", "Skill", "No automation"]).map((w: any) => (((contains(at(bodies, "sag-automation-scout"), w)))))).every((value:any)=>truth(value)));
check("Judgment: learning-extractor learns only from mismatches", ((contains(at(bodies, "sag-learning-extractor"), "a mismatch between expectation and reality"))));
check("Judgment: learning-extractor forbids general maxims", ((contains(at(bodies, "sag-learning-extractor"), "Do not generalize into maxims"))));
check("Judgment: followup-suggester distinguishes three cases", (Array.from(["Deliberately omitted", "Out of scope", "Time or sequence prevented completion"]).map((w: any) => (((contains(at(bodies, "sag-followup-suggester"), w)))))).every((value:any)=>truth(value)));
check("Judgment: followup-suggester orders by propagated blocking", ((contains(at(bodies, "sag-followup-suggester"), "propagated blocking"))));
check("Judgment: duplicate-checker requires an inspected location", ((contains(at(bodies, "sag-duplicate-checker"), "inspected location"))));
check("Judgment: duplicate-checker calls pathless existing claims impressions", ((contains(at(bodies, "sag-duplicate-checker"), "impression"))));
(on_disk=new Set(Array.from(readdirSync(SKILLS)).filter((d: any) => truth(((value:any)=>truth(value)?existsSync(join(SKILLS, d, "SKILL.md")):value)(isdir(join(SKILLS, d))))).map((d: any) => (d))));
(named=new Set());
for (let b of Object.values(bodies) as string[]) {
named=new Set([...named,...new Set(findall("skills/([a-z][a-z0-9-]+)/", b))]);
}
check("References: named skill paths are nonempty", (compare(length(named),1,">=")), (pyStr(sorted(named))));
check("References: every named skill exists", (Array.from(named).map((m: any) => (((contains(on_disk, m)))))).every((value:any)=>truth(value)), ("missing " + pyStr(Array.from(named).filter((m: any) => truth(((!contains(on_disk, m))))).map((m: any) => (m)))));
check_ref_contracts(check, ROOT, [["quality-auditor.md", "read-only · blocked by default · unchecked scope", ["Do not fix anything", "default verdict is **blocked**", "Say what you did not inspect", "Do not create a copy"], 1073], ["quality-executor.md", "three lock conditions · axis order · scope", ["directly observed tests passing", "revert that pass", "Fix only reported issues", "one-line finding"], 1068], ["quality-verifier.md", "four steps · vanished checks · unverified state", ["identifying and running", "target disappears", "Zero passing checks is not a pass", "unverified"], 955], ["sag-automation-scout.md", "identical decisions · four forms", ["same decision each time", "No automation", "cost of being wrong"], 1012], ["sag-doc-updater.md", "code-inferability · file and section", ["cannot infer from code", "not yet a concrete proposal", "Do not edit documentation directly"], 1033], ["sag-duplicate-checker.md", "inspected location · no new suggestions", ["inspected location", "Do not create new suggestions", "no verifier"], 904], ["sag-followup-suggester.md", "three distinctions · blocking order", ["Deliberately omitted", "Out of scope", "could not be completed", "propagated blocking"], 843], ["sag-learning-extractor.md", "mismatch-only learning · reproduction · no maxims", ["newly established session learning", "reproduction path", "Do not generalize into maxims"], 1128]], {label_prefix: "Agent contract", subdir: "agents", population: WANT});
(_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"agents/quality-auditor.md": 17, "agents/quality-executor.md": 15, "agents/quality-verifier.md": 16, "agents/sag-automation-scout.md": 10, "agents/sag-doc-updater.md": 10, "agents/sag-duplicate-checker.md": 12, "agents/sag-followup-suggester.md": 10, "agents/sag-learning-extractor.md": 10}, live_ran: _ran, completeness: false});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 115);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
