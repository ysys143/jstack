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

const CMD=join(ROOT, "commands");
const SCRIPTS=join(ROOT, "scripts");
const WANT=["check-usage", "convert", "dashboard-alias", "dashboard-repair", "dashboard-setup", "doctor", "grill-me", "gws", "interview", "report", "setup-workspace", "validate"];
// Only commands whose intent no public skill carries have a description; the rest cost nothing in the model-facing listing and show their first body line in the `/` menu.
const DESCRIBED=["branch", "commit", "convert", "doctor", "init", "inspect", "install-skill", "log", "pr", "project-checks", "ship", "skills", "test-plugin", "validate", "wrap"];
const DESCRIPTION_COLUMNS=60;
function commandDescription(fm:string):string|null{const m=/^description:[ \t]*(.*)$/m.exec(fm);if(!m)return null;const raw=m[1].trim();if(!raw.startsWith('"'))return raw;try{return JSON.parse(raw);}catch{return raw;}}
function menuLine(body:string):string{return body.split('\n').find(line=>line.trim()!=='')??'';}
function menuContract(name:string,text:string):boolean{const [fm,body]=split_frontmatter(text),description=commandDescription(fm);return DESCRIBED.includes(name)?description!==null&&description.length>0&&description.length<=DESCRIPTION_COLUMNS&&/^[\x20-\x7e]+$/.test(description):description===null&&menuLine(body).startsWith(`# /${name} — `);}
function subprocessRun(argv:string[],options:any={}):any{const r=runProcess(argv[0],argv.slice(1),{cwd:options.cwd??ROOT,env:options.env??process.env,timeout:120000});return {returncode:r.status,stdout:r.stdout,stderr:r.stderr};}
function run(script:string,...args:string[]):any{const env:NodeJS.ProcessEnv={...process.env,JSTACK_SKIP_DELETION:'1'};delete env.JSTACK_SUITE_EVIDENCE_DIR;const r=subprocessRun([process.execPath,join(SCRIPTS,script),...args],{env});return [r.returncode,r.stdout+r.stderr];}
function runnerFixture(failed:string|null,selected=false,missing=false):any{const base=temporaryDirectory();try{const root=join(base,'jstack');const put=(name:string,text:string)=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};put('contracts/ts-migration/deletion-floors.json',JSON.stringify({floors:{'skills/only':0}}));put('skills/only/tests/run.js',"console.log('1/1 통과');");for(const name of ['check_floor_parity.js','check_suite_lib_behaviour.js','check_suite_lib_parity.js'])if(!(missing&&name===failed))put('scripts/'+name,`console.log('reached:${name}');process.exitCode=${name===failed?1:0};`);const env={...process.env};delete env.JSTACK_SUITE_EVIDENCE_DIR;const moduleUrl=new URL('../scripts/run_suites.js',import.meta.url).href;return subprocessRun([process.execPath,'--input-type=module','-e',`import {runSuites} from ${JSON.stringify(moduleUrl)};process.exitCode=runSuites({root:${JSON.stringify(root)},selected:${JSON.stringify(selected?['only']:[])}});`],{env});}finally{removeTree(base);}}
function main():any{
let TABLE_RULE_OFF:any,_:any,_CHECKERS:any,_brs:any,_c:any,_d:any,_f:any,_floor:any,_has:any,_ln:any,_meta:any,_n:any,_need:any,_nested_env:any,_nosuite:any,_o:any,_p:any,_prop:any,_pt:any,_r:any,_rc:any,_sk:any,_src:any,_t:any,_target:any,_td:any,_tmp:any,_var:any,_vd:any,_why:any,all_names:any,bodies:any,body:any,cmd:any,conv:any,d:any,f:any,fm:any,ghost:any,help_skill:any,known:any,label:any,m:any,miss:any,n:any,named:any,names:any,ok:any,passed:any,path:any,r:any,r2:any,raw:any,refs:any,s:any,script:any,skills_dir:any,trap:any,want:any;
(all_names=sorted(Array.from(readdirSync(CMD)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (slice(f, 0, -(3))))));
check("Inventory: the unified command count is 36", (isDeepStrictEqual(length(all_names),36)), (pyStr(all_names)));
(names=sorted(WANT));
for (let want of WANT) {
check(("Inventory: /" + pyStr(want) + " is present"), ((contains(all_names, want))));
}
(bodies={});
for (let n of names) {
(raw=read(join(CMD, (n + ".md"))));
([fm,body]=split_frontmatter(raw));
(bodies[n]=body);
check(("Format: /" + pyStr(n) + (contains(DESCRIBED, n) ? " has a description of at most 60 columns" : " has no description and opens with its `/` menu line")), menuContract(n, raw));
}
for (let [cmd, script] of [["doctor", "doctor.js"], ["validate", "validate.js"]]) {
(path=join(SCRIPTS, script));
check(("Execution: /" + pyStr(cmd) + "'s script exists"), existsSync(path));
check(("Execution: /" + pyStr(cmd) + " documentation points to its script"), ((contains(at(bodies, cmd), ("scripts/" + pyStr(script))))));
}
(r=subprocessRun([process.execPath, join(SCRIPTS, "doctor.js")],{capture_output:true,text:true}));
check("Decision: doctor completes", ((contains([0, 1], r.returncode))), ("rc=" + pyStr(r.returncode)));
for (let label of ["[ready]", "[self-contained]", "[blocked]"]) {
check(("Decision: doctor output defines the " + pyStr(label) + " class"), ((contains(at(bodies, "doctor"), label))));
}
check("Decision: doctor scans all 10 skills", (isDeepStrictEqual(length(findall("(?m)^\\s+\\[(?:ready|self-contained|partial|blocked)\\]", r.stdout)),10)), (pyStr(length(findall("(?m)^\\s+\\[(?:ready|self-contained|partial|blocked)\\]", r.stdout))) + " rows"));
check("Decision: research is counted as self-contained (exit 1 is not a defect)", ((search("\\[self-contained\\]\\s+research|\\[ready\\]\\s+research", r.stdout) !== null)), slice(Array.from(lines(r.stdout)).filter((_ln: any) => truth(((contains(_ln, "research"))))).map((_ln: any) => (_ln)), 0, 1));
(r2=subprocessRun([process.execPath, join(SCRIPTS, "validate.js")],{capture_output:true,text:true}));
check("Decision: validate stops with rc=2 without arguments", (isDeepStrictEqual(r2.returncode,2)), ("rc=" + pyStr(r2.returncode)));
(conv=at(bodies, "convert"));
check("Trap: convert has a section on hard-to-reverse choices", ((contains(conv, "Choices that are hard to reverse"))));
for (let trap of ["Text inside an image", "image slides", "typesetting"]) {
check(("Trap: convert warns about `" + pyStr(trap) + "`"), ((contains(conv, trap))));
}
check("Trap: convert fixes the chain order", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(conv, "proof"))):value)(((contains(conv, "humanize")))):value)(((contains(conv, "Keep this order")))));
const reportBody=at(bodies, "report");
check("Restraint: /report submits only drafts approved in this retrospective", contains(reportBody, "Do not submit a draft the user has not approved"));
check("Restraint: /report does not treat a missing transcript source as no problems", contains(reportBody, "instead of reporting that there were no problems"));
check("Restraint: /report does not invent expected behavior", contains(reportBody, "Do not invent expected behavior"));
check("Execution: /report points to the issue-report CLI", contains(reportBody, "skills/issue-report/scripts/main.js")&&isfile(join(ROOT, "skills", "issue-report", "scripts", "main.js")));
check("Decision: /report tells the user before drafting when the target repository is not the default", search("status\\s+prints\\s+a\\s+WARNING[\\s\\S]*?tell\\s+the\\s+user\\s+before\\s+drafting", reportBody)!==null);
check("Restraint: /report passes --repo only for a repository the user chose for one submission", search("`--repo OWNER/NAME`\\s+only\\s+when\\s+the\\s+user\\s+chose\\s+that\\s+repository\\s+for\\s+this\\s+one\\s+submission", reportBody)!==null);
check("Decision: /report asks which repository to use when the configured one is invalid", search("Exit\\s+2\\s+because\\s+the\\s+configured\\s+repository\\s+is\\s+invalid\\s+means\\s+nothing\\s+was\\s+sent;\\s+ask\\s+the\\s+user\\s+which\\s+repository", reportBody)!==null);
for (const [cmd, needles] of [["interview", ["Follow the `requirements-interview` skill in interview mode", "Read the evidence before asking anything", "skill's stop condition"]], ["grill-me", ["Follow the `requirements-interview` skill in grill mode", "in order of cost if wrong", "until the user says stop or every listed assumption has an outcome"]]] as [string, string[]][]) {
const commandBody=at(bodies, cmd);
for (const needle of needles) check(("Restraint: /" + cmd + " says \"" + needle + "\""), contains(commandBody, needle));
check(("Restraint: /" + cmd + " never edits contract.yaml or writes code"), contains(commandBody, "Never edit `contract.yaml`")&&search("[Nn]ever write code from this command", commandBody)!==null);
}
(skills_dir=join(ROOT, "skills"));
(known=new Set(Array.from(readdirSync(skills_dir)).filter((d: any) => truth(((value:any)=>truth(value)?!truth(starts(d, ["_", "."])):value)(isdir(join(skills_dir, d))))).map((d: any) => (d))));
(TABLE_RULE_OFF={"dashboard-setup": "It lists 38 widgets in the same table shape; they are not skill names"});
for (let [_c, _why] of sorted(Object.entries(TABLE_RULE_OFF))) {
check(("Reference: /" + pyStr(_c) + " has a reason for excluding the table rule"), truth(strip(_why)));
check(("Reference: table-rule exception /" + pyStr(_c) + " is a real command"), ((contains(bodies, _c))));
}
for (let [n, body] of Object.entries(bodies) as [string,string][]) {
(named=new Set(findall("`([a-z][a-z0-9-]{2,})`\\s*skill", body)));
if(truth(((!contains(TABLE_RULE_OFF, n))))) {
named=new Set([...named,...new Set(Array.from(findall("\\|\\s*`([a-z][a-z0-9-]{2,})`\\s*\\|", body)).map((m: any) => (m)))]);
}
(ghost=sorted(new Set([...named].filter((name:string)=>!known.has(name)))));
check(("Reference: every skill named by /" + pyStr(n) + " exists"), !truth(ghost), ("missing " + pyStr(ghost)));
}
for (let [n, body] of Object.entries(bodies) as [string,string][]) {
(refs=findall("skills/([a-z-]+)/scripts/([\\w.-]+)", body));
(miss=Array.from(refs).filter(([s, f]: any) => truth(!truth(existsSync(join(skills_dir, s, "scripts", f))))).map(([s, f]: any) => ((pyStr(s) + "/" + pyStr(f)))));
check(("Reference: every script named by /" + pyStr(n) + " exists"), !truth(miss), ("missing " + pyStr(miss)));
}
(help_skill=read(join(SKILLS, "help", "SKILL.md")));
check("Index: the help skill points to the capability catalog", ((contains(help_skill, "CAPABILITIES.md"))));
(_nosuite=[]);
for (let _sk of sorted(readdirSync(SKILLS))) {
(_d=join(SKILLS, _sk));
if(truth(!truth(isfile(join(_d, "SKILL.md"))))) {
continue;
}
(_td=join(_d, "tests"));
(_has=((value:any)=>truth(value)?(Array.from(readdirSync(_td)).map((f: any) => (((value:any)=>truth(value)?!truth(starts(f, "_")):value)(ends(f, ".js"))))).some((value:any)=>truth(value)):value)(isdir(_td)));
if(truth(!truth(_has))) {
_nosuite.push(_sk);
}
}
check("Reachability: every skill has a contract suite", !truth(_nosuite), (pyStr(_nosuite)));
const selectedResult=runnerFixture(null,true);
check("Runner: selected execution retains floor and harness checks",selectedResult.returncode===0&&['check_floor_parity.js','check_suite_lib_behaviour.js','check_suite_lib_parity.js'].every(name=>selectedResult.stdout.includes('reached:'+name)));
const missingResult=runnerFixture('check_floor_parity.js',false,true);
check("Runner: missing contract checkers fail closed",missingResult.returncode===2&&missingResult.stderr.includes('Contract checker is missing'));
const checkers=['check_floor_parity.js','check_suite_lib_behaviour.js','check_suite_lib_parity.js'];
const controls=checkers.map(name=>runnerFixture(name));
check("Runner: the meta block has three failure propagations",controls.every(r=>r.returncode===1),controls.map(r=>r.returncode).join(','));
const green=runnerFixture(null);
check("Runner: the same full-run branch executes all checkers for passing and failing inputs",green.returncode===0&&[green,...controls].every(r=>checkers.every(name=>r.stdout.includes('reached:'+name))));
for(const name of checkers)check('Runner: source invokes the '+name+' checker',read(join(SCRIPTS,'run_suites.js')).includes(name),name);
for(const [i,name] of checkers.entries())check('Runner: propagates '+name+' checker failure in its exit code',controls[i].returncode===1&&controls[i].stdout.includes('reached:'+name),controls[i].stderr);
(_vd=read(join(CMD, "test-plugin.md")));
check("Reachability: /test-plugin points to the contract-suite runner", ((contains(_vd, "run_suites.js"))));
check("Reachability: that runner exists", isfile(join(SCRIPTS, "run_suites.js")));
check("Reachability: /test-plugin explains the difference between validations", ((value:any)=>truth(value)?((contains(_vd, "contract suite"))):value)(((contains(_vd, "format and content of user-created deliverables")))));
for (let [_f, _floor, _need] of [["ATTRIBUTION.md", 1847, "adapted"], ["fluent-korean.md", 4899, "name: fluent-korean"], ["fluent-korean-not-coding.md", 4667, "name: fluent-korean-not-coding"]]) {
(_p=join(ROOT, "output-styles", String(_f)));
(_t=(truth(isfile(_p)) ? read(_p) : ""));
check(("Output style: " + pyStr(_f) + " preserves its measured volume"), (compare(length(Buffer.from(_t,"utf8")),_floor,">=")), (pyStr(length(Buffer.from(_t,"utf8"))) + "B (floor " + pyStr(_floor) + "B)"));
check(("Output style: " + pyStr(_f) + " declares its identity"), ((contains(_t, _need))), _need);
(_r=subprocessRun(["git", "diff", "--quiet", "HEAD", "--", _p],{cwd:ROOT,capture_output:true}));
check(("Output style: " + pyStr(_f) + " matches the committed copy"), ((contains([0, 128], _r.returncode))), (truth(((contains([0, 128], _r.returncode)))) ? "" : "modified in the working tree; editing an imported copy can invalidate attribution"));
}
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"hooks/CONTRACT.md": 1, "AGENTS.md": 1, "contracts/portable-contract.yaml": 1, "contracts/claims.yaml": 1, "contracts/change-impact.yaml": 1, "CHANGELOG.md": 1, "README.md": 1, "agents/ai-tell-detector.md": 1, "agents/content-fidelity-auditor.md": 1, "agents/korean-ai-tell-taxonomist.md": 1, "agents/korean-procurement-detector.md": 1, "agents/korean-procurement-fidelity-auditor.md": 1, "agents/korean-procurement-naturalness-reviewer.md": 1, "agents/korean-procurement-rewriter.md": 1, "agents/korean-style-rewriter.md": 1, "agents/naturalness-reviewer.md": 1, "commands/check-usage.md": 1, "commands/dashboard.md": 1, "commands/dashboard-alias.md": 1, "commands/dashboard-repair.md": 1, "commands/convert.md": 1, "commands/doctor.md": 1, "commands/gws.md": 1, "commands/grill-me.md": 1, "commands/interview.md": 1, "commands/report.md": 1, "commands/setup-workspace.md": 1, "commands/validate.md": 1, "evals/discriminating/deck-design-slop/case.yaml": 1, "evals/discriminating/deck-design-slop/graders/criteria.md": 1, "evals/discriminating/deck-design-slop/graders/counts.md": 1, "evals/discriminating/deck-design-slop/graders/tag_median.md": 1, "evals/discriminating/deck-design-slop/graders/tag_no_constraint.md": 1, "evals/discriminating/deck-design-slop/graders/tag_no_verify.md": 1, "evals/discriminating/deck-design-slop/graders/tag_underspec.md": 1, "evals/discriminating/deck-design-slop/graders/skill_fired.md": 1, "evals/discriminating/deck-design-slop/prompt.md": 1, "evals/discriminating/diagram-connector-rules/case.yaml": 1, "evals/discriminating/diagram-connector-rules/graders/criteria.md": 1, "evals/discriminating/diagram-connector-rules/graders/rule0.md": 1, "evals/discriminating/diagram-connector-rules/graders/gap.md": 1, "evals/discriminating/diagram-connector-rules/graders/rule2.md": 1, "evals/discriminating/diagram-connector-rules/graders/skill_fired.md": 1, "evals/discriminating/diagram-connector-rules/prompt.md": 1, "evals/discriminating/hwpx-format-units/case.yaml": 1, "evals/discriminating/hwpx-format-units/graders/criteria.md": 1, "evals/discriminating/hwpx-format-units/graders/a4h.md": 1, "evals/discriminating/hwpx-format-units/graders/skill_fired.md": 1, "evals/discriminating/hwpx-format-units/prompt.md": 1, "evals/parity/general-vs-upstream/case.yaml": 1, "evals/parity/general-vs-upstream/graders/criteria.md": 1, "evals/parity/general-vs-upstream/graders/skill_fired.md": 1, "evals/parity/general-vs-upstream/prompt.md": 1, "evals/regression/humanize-general/case.yaml": 1, "evals/regression/humanize-general/graders/block.md": 1, "evals/regression/humanize-general/graders/criteria.md": 1, "evals/regression/humanize-general/graders/fix_antithesis.md": 1, "evals/regression/humanize-general/graders/fix_cliche.md": 1, "evals/regression/humanize-general/graders/fix_means.md": 1, "evals/regression/humanize-general/graders/fix_metaphor.md": 1, "evals/regression/humanize-general/graders/keep_count.md": 1, "evals/regression/humanize-general/graders/keep_period.md": 1, "evals/regression/humanize-general/graders/skill_fired.md": 1, "evals/regression/humanize-general/prompt.md": 1, "evals/regression/humanize-procurement/case.yaml": 1, "evals/regression/humanize-procurement/graders/criteria.md": 1, "evals/regression/humanize-procurement/graders/skill_fired.md": 1, "evals/regression/humanize-procurement/prompt.md": 1, "evals/regression/humanize-taxonomy-recall/case.yaml": 1, "evals/regression/humanize-taxonomy-recall/graders/criteria.md": 1, "evals/regression/humanize-taxonomy-recall/graders/count_K.md": 1, "evals/regression/humanize-taxonomy-recall/graders/count_L.md": 1, "evals/regression/humanize-taxonomy-recall/graders/count_M.md": 1, "evals/regression/humanize-taxonomy-recall/graders/count_N.md": 1, "evals/regression/humanize-taxonomy-recall/graders/count_O.md": 1, "evals/regression/humanize-taxonomy-recall/graders/skill_fired.md": 1, "evals/regression/humanize-taxonomy-recall/prompt.md": 1, "output-styles/ATTRIBUTION.md": 1, "output-styles/fluent-korean-not-coding.md": 1, "output-styles/fluent-korean.md": 1}, measure: false, completeness: false});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 108);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
