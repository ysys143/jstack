/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {runProcess} from '../runtime/os.js';
import {check_no_constant_assertions,check_total,check_ref_contracts,split_frontmatter,check_contract_coverage,type Result} from '../skills/_suite_lib.js';
import {truth,length,contains,sorted,repr,at,slice,strip,split,lines,starts,ends,replace,findall,search,group,isdir,temporaryDirectory,removeTree} from '../skills/_suite_lib_native.js';
import {inspect} from '../scripts/inspect.js';
import {doctor} from '../scripts/doctor.js';
import {doctorDev} from '../scripts/doctor-dev.js';
import {search as searchApi,searchUrl} from '../scripts/search_api.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=join(ROOT,"skills");
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const CMD=join(ROOT, "commands");
const SCRIPTS=join(ROOT, "scripts");
const WANT=["brainstorming", "branch", "commit", "consensus-plan", "daily-wrapup", "doctor", "inspect", "install-skill", "log", "pr", "setup-recall", "ship", "skills", "tidy", "test-plugin", "weekly-wrapup", "wrap"];
// Only commands whose intent no public skill carries have a description; the rest cost nothing in the model-facing listing and show their first body line in the `/` menu.
const DESCRIBED=["branch", "commit", "convert", "doctor", "init", "inspect", "install-skill", "log", "pr", "project-checks", "ship", "skills", "test-plugin", "validate", "wrap"];
const DESCRIPTION_COLUMNS=60;
function commandDescription(fm:string):string|null{const m=/^description:[ \t]*(.*)$/m.exec(fm);if(!m)return null;const raw=m[1].trim();if(!raw.startsWith('"'))return raw;try{return JSON.parse(raw);}catch{return raw;}}
function menuLine(body:string):string{return body.split('\n').find(line=>line.trim()!=='')??'';}
function menuContract(name:string,text:string):boolean{const [fm,body]=split_frontmatter(text),description=commandDescription(fm);return DESCRIBED.includes(name)?description!==null&&description.length>0&&description.length<=DESCRIPTION_COLUMNS&&/^[\x20-\x7e]+$/.test(description):description===null&&menuLine(body).startsWith(`# /${name} — `);}
function subprocessRun(argv:string[],options:any={}):any{const r=runProcess(argv[0],argv.slice(1),{cwd:options.cwd??ROOT,env:options.env??process.env,timeout:120000});return {returncode:r.status,stdout:r.stdout,stderr:r.stderr};}
function run(script:string,...args:string[]):any{const env:NodeJS.ProcessEnv={...process.env,JSTACK_SKIP_DELETION:'1'};if(script==='run_suites.js')delete env.JSTACK_SKIP_DELETION;delete env.JSTACK_SUITE_EVIDENCE_DIR;const r=subprocessRun([process.execPath,join(SCRIPTS,script),...args],{env});return [r.returncode,r.stdout+r.stderr];}
function runnerFixture(failed:string|null,selected=false,missing=false,throughCli=false):any{const base=temporaryDirectory();try{const root=join(base,'jstack');const put=(name:string,text:string)=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};put('contracts/ts-migration/deletion-floors.json',JSON.stringify({floors:{'skills/only':0}}));put('skills/only/tests/run.js',"console.log('1/1 통과');");for(const name of ['check_floor_parity.js','check_suite_lib_behaviour.js','check_suite_lib_parity.js'])if(!(missing&&name===failed))put('scripts/'+name,`console.log('reached:${name}');process.exitCode=${name===failed?1:0};`);const env={...process.env};delete env.JSTACK_SUITE_EVIDENCE_DIR;if(throughCli){env.JSTACK_RUNTIME_ROOT=root;delete env.JSTACK_SKIP_DELETION;return subprocessRun([process.execPath,join(SCRIPTS,'run_suites.js'),...(selected?['only']:[])],{env});}const moduleUrl=new URL('../scripts/run_suites.js',import.meta.url).href;return subprocessRun([process.execPath,'--input-type=module','-e',`import {runSuites} from ${JSON.stringify(moduleUrl)};process.exitCode=runSuites({root:${JSON.stringify(root)},selected:${JSON.stringify(selected?['only']:[])}});`],{env});}finally{removeTree(base);}}
function inspectedFixture(kind:'bare'|'broken'):any{const base=temporaryDirectory();try{const skill=join(base,'skills',kind);mkdirSync(skill,{recursive:true});writeFileSync(join(skill,'SKILL.md'),'---\nname: '+kind+'\ndescription: x\n---\n\nx\n');if(kind==='broken'){mkdirSync(join(skill,'tests/refs'),{recursive:true});writeFileSync(join(skill,'tests/refs/SKILL.md.lines'),'# blob: 0\nx\n');writeFileSync(join(skill,'tests/run.js'),"console.log('[FAIL] deliberately broken contract');console.log('0/1 통과');process.exitCode=1;");}const r=inspect(kind,base);return {returncode:r.code,stdout:r.lines.join('\n')};}finally{removeTree(base);}}
async function main():Promise<number>{
let _ALL:any,_MINE:any,_SKIP:any,_agent_files:any,_d:any,_got:any,_has:any,_m:any,_mismatch:any,_nosuite:any,_o:any,_outs:any,_ran:any,_rc:any,_sa:any,_skill_dirs:any,_skills:any,_td:any,_want_l1:any,_want_l2:any,_want_l3:any,all_names:any,bodies:any,body:any,fm:any,named:any,names:any,on_disk:any,out:any,out_t:any,p:any,passed:any,r:any,rc:any,rc_t:any;
(all_names=sorted(Array.from(readdirSync(CMD)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (slice(f, 0, -(3))))));
check("Inventory: the unified command count is 35", (isDeepStrictEqual(length(all_names),35)), (pyStr(all_names)));
(names=sorted(WANT));
(_skill_dirs=sorted(Array.from(readdirSync(join(ROOT, "skills"))).filter((d: any) => truth(isfile(join(ROOT, "skills", d, "SKILL.md")))).map((d: any) => (d))));
(_agent_files=sorted(Array.from(readdirSync(join(ROOT, "agents"))).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (f))));
for (let [_label, _real, _expected] of [["skills", length(_skill_dirs), 41], ["commands", length(all_names), 35], ["agents", length(_agent_files), 17]]) {
check(("Inventory: unified " + pyStr(_label) + " count matches the fixed inventory"), (isDeepStrictEqual(_real,_expected)), ("expected " + pyStr(_expected) + " / actual " + pyStr(_real)));
}
for (let w of WANT) {
check(("Inventory: /" + pyStr(w) + " is present"), ((contains(all_names, w))));
}
(bodies={});
for (let n of names) {
const commandText=read(join(CMD, (n + ".md")));
([fm,body]=split_frontmatter(commandText));
(bodies[n]=body);
check(("Format: /" + pyStr(n) + (contains(DESCRIBED, n) ? " has a description of at most 60 columns" : " has no description and opens with its `/` menu line")), menuContract(n, commandText));
check(("Flow: /" + pyStr(n) + " body contains procedure or judgment, not one routing line"), (compare(length(strip(body)),400,">")), (pyStr(length(strip(body))) + "B"));
}
{const withDescription=all_names.filter((name:string)=>commandDescription(split_frontmatter(read(join(CMD, name + ".md")))[0])!==null),offenders=all_names.filter((name:string)=>!menuContract(name, read(join(CMD, name + ".md"))));
check("Format: exactly the 15 named commands carry a description and every other command opens with `# /<name> — `", isDeepStrictEqual(sorted(withDescription),sorted(DESCRIBED))&&!offenders.length, ("described " + pyStr(sorted(withDescription)) + " / off contract " + pyStr(offenders)));}
for (let [cmd, script] of [["doctor", "doctor.js"], ["test-plugin", "run_suites.js"], ["inspect", "inspect.js"]]) {
(p=join(SCRIPTS, script));
check(("Execution: " + pyStr(script) + " exists and is executable"), ((value:any)=>truth(value)?true:value)(isfile(p)));
check(("Execution: /" + pyStr(cmd) + " points to that script"), ((contains(at(bodies, cmd), script))));
}
([rc,out]=run("inspect.js","definitely-no-such-skill"));
check("Measured: inspect returns 2 for a missing skill", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc,out]=run("inspect.js","help"));
const inspectPassingStatus=rc;
check("Measured: inspect returns 0 for a skill with a passing contract", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
check("Measured: inspect output contains layers and contract results", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(out, "Frozen references —"))):value)(((contains(out, "Contract ")))):value)(((contains(out, "[L1] SKILL.md")))));
([rc_t,out_t]=run("inspect.js","tdd"));
check("Measured: inspect counts langs/ as L2", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(at(split(out_t, "[L3]"), 0), " 0 items"))):value)(((contains(out_t, "[L2]")))):value)(((contains(out_t, "langs/")))):value)((isDeepStrictEqual(rc_t,0))), replace(strip(at(split(out_t, "[L3]"), 0)), "\n", " | "));
(_sa=join(SCRIPTS, "search_api.js"));
check("Execution: search_api.sh exists and is executable", ((value:any)=>truth(value)?true:value)(isfile(_sa)));
const httpFailure=await searchApi(['skills','q'],(async()=>new Response('failed',{status:503})) as typeof fetch);
check('Restraint: search API propagates HTTP failure',httpFailure.code===1&&httpFailure.text.includes('503'));
let endpointRejected=false;try{searchUrl(['nope','q']);}catch{endpointRejected=true;}
check('Restraint: search API locks two endpoints',endpointRejected&&searchUrl(['skills','q']).pathname==='/api/skills/search'&&searchUrl(['plugins','q']).pathname==='/api/search');
([_rc,_o]=run('search_api.js'));check('Measured: search API rejects missing arguments with usage',_rc===1&&_o.includes('Usage:'));
([_rc,_o]=run('search_api.js','nope','q'));check('Measured: search API rejects unknown endpoint',_rc===1);
const noNetwork=await searchApi(['skills','q'],(async()=>{throw new Error('connection unavailable');}) as typeof fetch);
check('Measured: search API reports blocked transport',noNetwork.code===1&&noNetwork.text.includes('connection unavailable'));
// Exercise the public CLI without rerunning an unrelated skill's deletion suite.
r=runnerFixture(null,true,false,true);rc=r.returncode;out=r.stdout+r.stderr;
check("Measured: validate returns 0 on success", isDeepStrictEqual(rc,0)&&['check_floor_parity.js','check_suite_lib_behaviour.js','check_suite_lib_parity.js'].every(name=>out.includes('reached:'+name)), ("rc=" + pyStr(rc)));
check("Measured: validate output reports suite count", ((contains(out, "Suites"))), slice(strip(out), 0, 80));
([rc,out]=run("run_suites.js","no-such-skill"));
check("Measured: validate returns 2 when there is nothing to run (not 0)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
{const tmp=temporaryDirectory();try{const env={...process.env,JSTACK_RUNTIME_ROOT:tmp};const r=subprocessRun([process.execPath,join(SCRIPTS,'run_suites.js')],{env});check('Measured: validate returns 2 when no skills exist',r.returncode===2,r.stderr);}finally{removeTree(tmp);}}
(r=inspectedFixture('bare'));check('Measured: inspect rejects a skill without a contract',r.returncode===1);check('Measured: inspect explicitly reports missing contract',r.stdout.includes('Contract — none'));
([rc,out]=run("doctor-dev.js"));
check("Measured: doctor returns one of 0, 1, or 2", ((contains([0, 1, 2], rc))), ("rc=" + pyStr(rc)));
const calls:string[]=[];const dispatchedDoctor=doctor([],{dev:()=>{calls.push('dev');return {code:1,lines:['dev']};},work:()=>{calls.push('work');return {code:2,lines:['work']};}});
check('Measured: unified doctor calls both diagnostics and propagates highest status',dispatchedDoctor.code===2&&calls.join(',')==='dev,work'&&dispatchedDoctor.lines.join(',')==='dev,work');
const unauthenticated=doctorDev((command,args)=>({status:command==='gh'&&args[0]==='auth'?1:0,stdout:command==='node'?'v20.0.0':''}));
check('Measured: doctor reports unauthenticated gh as partial',unauthenticated.code===1);
check('Measured: doctor names the lost functionality',unauthenticated.lines.join(' ').includes('unauthenticated')&&unauthenticated.lines.join(' ').includes('/pr falls back to browser instructions'));
check("Measured: doctor emits output even in state 0 because it was explicitly invoked", (!isDeepStrictEqual(strip(out),"")), pyStr(slice(out, 0, 60)));
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
(r=inspectedFixture('broken'));
check('Measured: inspect rejects a failing contract',r.returncode!==0);
check('Measured: inspect exposes the original failure',r.stdout.includes('deliberately broken contract'));
check('Measured: inspect counts frozen references',r.stdout.includes('Frozen references — 1 items'));
(_skills=Array.from(sorted(readdirSync(SKILLS))).filter((_s: any) => truth(isfile(join(SKILLS, _s, "SKILL.md")))).map((_s: any) => (_s)));
_outs=Object.fromEntries(_skills.map((n:string)=>[n,inspect(n,ROOT,(()=>({status:0,stdout:"inventory probe",stderr:""})) as any).lines.join("\n")]));
(_mismatch=[]);
for (let _sk of _skills) {
(_d=join(SKILLS, _sk));
(_o=at(_outs, _sk));
(_want_l2=(Array.from(["references", "langs"]).filter((_sub: any) => truth(isdir(join(_d, _sub)))).map((_sub: any) => (length(readdirSync(join(_d, _sub)))))).reduce((total:number,value:any)=>total+Number(value),0));
(_want_l3=(truth(isdir(join(_d, "scripts"))) ? length(readdirSync(join(_d, "scripts"))) : 0));
(_want_l1=length(lines(read(join(_d, "SKILL.md")))));
for (let [_lbl, _want, _pat] of [["L1", _want_l1, "\\[L1\\][^\\n]*?(\\d+) lines"], ["L2", _want_l2, "\\[L2\\][^\\n]*?(\\d+) items"], ["L3", _want_l3, "\\[L3\\][^\\n]*?(\\d+) items"]]) {
(_m=search(String(_pat), _o));
(_got=(truth(_m) ? Number(group(_m, 1)) : null));
if(truth((!isDeepStrictEqual(_got,_want)))) {
_mismatch.push((pyStr(_sk) + "/" + pyStr(_lbl) + ": reported " + pyStr(_got) + " / actual " + pyStr(_want)));
}
}
}
check("Measured: inspect layer counts match the tree for every skill", !truth(_mismatch), (pyStr(slice(_mismatch, 0, 6))));
for(const [tool,want] of [['node',2],['git',2],['rg',1],['gh',1],['jq',1],['jst',1]] as [string,number][]){const result=doctorDev((command)=>({status:command===tool?1:0,stdout:command==='node'?'v20.0.0':''}));check('Measured: missing '+tool+' has correct status',result.code===want);check('Measured: doctor names missing '+tool,result.lines.join(' ').includes(tool));}
const cliPath=read(join(ROOT,'runtime','CLI-PATH.md'));
check('Guide: a missing jstack is reported as a PATH fault, never routed around',contains(cliPath,'not a reason to change the task')&&contains(cliPath,'Do not substitute a Node absolute path')&&contains(cliPath,'packaged script'));
check('Guide: a missing jstack names the cause per host',['and restart the session','trusts it in `/hooks`','`~/.local/bin` is not on PATH','`JSTACK_NO_PATH_LINK=1`','`npm install -g`','in a live Codex session','Codex on Windows gets','runs the Bash tool in Git Bash','link into a jstack plugin cache, its own or one made by hand','through `CLAUDE_ENV_FILE`','`allowManagedHooksOnly`','works whatever the hooks do'].every(phrase=>contains(cliPath,phrase)));
check('Guide: fixes are proposed with real paths and applied only after the user agrees',['apply it only after the user agrees','Use the real path, never a placeholder','writing any single quote inside it as','do not overwrite it','command -v jst && jst --version','continue the original task with plain `jstack ...`'].every(phrase=>contains(cliPath,phrase)));
{const unlinked=readdirSync(SKILLS).flatMap((name:string)=>['SKILL.md','SKILL.codex.md'].map(file=>join(name,file))).filter((rel:string)=>{const path=join(SKILLS,rel);if(!isfile(path))return false;const text=readFileSync(path,'utf8');return /`jstack (?:disk|report|route|task|jev|init|profiles|catalog)\b/.test(text)&&!text.includes('](../../runtime/CLI-PATH.md)');});
check('Guide: every skill body that runs jstack points to the guide',!unlinked.length,pyStr(unlinked));}
const statuses:Record<string,Set<string>>={
  'test-plugin':new Set([green.returncode,controls[0].returncode,missingResult.returncode].map(String)),
  inspect:new Set([inspectPassingStatus,inspectedFixture('bare').returncode,inspect('absent-fixture',ROOT).code].map(String)),
  doctor:new Set([0,1,2].map(code=>String(doctor([],{dev:()=>({code,lines:[]}),work:()=>({code:0,lines:[]})}).code)))
};
for(const cmd of ['test-plugin','inspect','doctor']){const declared=new Set(findall('(?m)^\\| (\\d) \\|',bodies[cmd]));check('Match: /'+cmd+' documents its measured exit codes',declared.size>0&&[...declared].every(code=>statuses[cmd].has(code)),[...statuses[cmd]].join(','));}
check("Restraint: /commit explicitly forbids pushing", ((contains(at(bodies, "commit"), "Do not push"))));
check("Restraint: /commit prevents the --no-verify bypass", ((contains(at(bodies, "commit"), "--no-verify"))));
check("Restraint: /branch forbids remote creation", ((contains(at(bodies, "branch"), "Do not create a remote branch"))));
check("Restraint: /branch prevents forced movement of existing branches", ((contains(at(bodies, "branch"), "Do not force-move"))));
check("Restraint: /pr forbids merging on the user's behalf", ((contains(at(bodies, "pr"), "Do not merge on the user's behalf"))));
check("Restraint: /ship forbids pushing or merging", ((contains(at(bodies, "ship"), "Do not push or merge"))));
check("Restraint: /ship does not offer verification bypasses", ((contains(at(bodies, "ship"), "Do not suggest a bypass"))));
check("Restraint: /doctor does not install on the user's behalf", ((contains(at(bodies, "doctor"), "Do not install on the user's behalf"))));
check("Restraint: /tidy does not change behavior", ((contains(at(bodies, "tidy"), "Do not change behavior"))));
check("Restraint: /tidy forbids deleting tests to go green", ((contains(at(bodies, "tidy"), "Deleting tests to make them green is not cleanup"))));
check("Judgment: /commit explains why one commit has one reason", ((contains(at(bodies, "commit"), "revert only half"))));
check("Judgment: /commit requires the repository's message style", ((value:any)=>truth(value)?((contains(at(bodies, "commit"), "not personal preference"))):value)(((contains(at(bodies, "commit"), "last 20")))));
check("Judgment: /branch explains the cost of branching from a dirty tree", ((value:any)=>truth(value)?((contains(at(bodies, "branch"), "carries"))):value)(((contains(at(bodies, "branch"), "other people's changes")))));
check("Judgment: /pr forbids restating the diff as prose", ((contains(at(bodies, "pr"), "Do not rewrite the diff as prose"))));
check("Judgment: /pr has at least four required description rows", (compare(length(findall("(?m)^\\| (?!---)(?!Item)", at(bodies, "pr"))),4,">=")));
check("Judgment: /ship explains stage ordering", ((contains(at(bodies, "ship"), "only when the preceding step is green"))));
check("Judgment: /ship says a gate that does not block is worse", ((contains(at(bodies, "ship"), "A gate that exists but does not block is worse"))));
check("Offer: /pr asks once per branch, records the answer, and never starts the walkthrough unasked", ((contains(at(bodies, "pr"), "ask once per branch")) && (contains(at(bodies, "pr"), "never start it without a yes")) && (contains(at(bodies, "pr"), "jstack-walkthrough declined")) && (contains(at(bodies, "pr"), "`journey-qa`"))));
check("Offer: /ship makes the walkthrough an offer, never starts it unasked, and does not change the verdict", ((contains(at(bodies, "ship"), "This is an offer, not a gate")) && (contains(at(bodies, "ship"), "Never start it without a yes")) && (contains(at(bodies, "ship"), "does not change the verdict")) && (contains(at(bodies, "ship"), "`journey-qa`"))));
check("Judgment: /wrap requires listing unfinished work first", ((contains(at(bodies, "wrap"), "Record unfinished work first"))));
check("Judgment: /wrap forbids saving progress", ((contains(at(bodies, "wrap"), "Do not store progress status"))));
check("Judgment: /tidy provides three baseline-lock conditions", ((value:any)=>truth(value)?((contains(at(bodies, "tidy"), "directly observed"))):value)(((contains(at(bodies, "tidy"), "git status --short")))));
check("Judgment: /tidy orders axis 6 before axis 5", ((value:any)=>truth(value)?((contains(at(bodies, "tidy"), "**before**"))):value)(((contains(at(bodies, "tidy"), "axis 5")))));
check("Judgment: /log distinguishes chronological from comprehension order", ((contains(at(bodies, "log"), "not comprehension"))));
check("Judgment: /log forbids inventing reasons", ((contains(at(bodies, "log"), "reason unknown"))));
check("Judgment: /skills explains why it keeps no copied inventory", ((contains(at(bodies, "skills"), "silently becomes stale"))));
check("Judgment: /skills distinguishes its role from help", ((value:any)=>truth(value)?((contains(at(bodies, "skills"), "what to use"))):value)(((contains(at(bodies, "skills"), "what exists")))));
check("Judgment: /test-plugin explains the danger of zero passing checks", ((contains(at(bodies, "test-plugin"), "A missing check did not pass"))));
check("Judgment: /test-plugin identifies check_total as a change detector", ((contains(at(bodies, "test-plugin"), "change detector"))));
check("Judgment: /inspect explains why a missing contract returns 1", ((contains(at(bodies, "inspect"), "Returning 1 for absent contracts is intentional"))));
check("Judgment: /doctor explains why code 1 is distinct", ((contains(at(bodies, "doctor"), "which exact feature is unavailable"))));
(on_disk=new Set(Array.from(readdirSync(SKILLS)).filter((d: any) => truth(((value:any)=>truth(value)?existsSync(join(SKILLS, d, "SKILL.md")):value)(isdir(join(SKILLS, d))))).map((d: any) => (d))));
(named={});
for (let [n, b] of Object.entries(bodies) as [string,string][]) {
for (let m of findall("`([a-z][a-z0-9-]{2,})`\\s*skill", b)) {
(named[m]??=[]).push(n);
}
}
check("References: commands name at least four skills", (compare(length(named),4,">=")), (pyStr(sorted(named))));
check("References: every named skill exists", (Object.keys(named).map((m: any) => (((contains(on_disk, m)))))).every((value:any)=>truth(value)), ("missing " + pyStr(Object.keys(named).filter((m: any) => truth(((!contains(on_disk, m))))).map((m: any) => (m)))));
for (let [n, b] of Object.entries(bodies) as [string,string][]) {
for (let path of findall("(?<![\\w/])scripts/([a-z_]+\\.js)", b)) {
check(("References: /" + pyStr(n) + " points to existing scripts/" + pyStr(path)), isfile(join(SCRIPTS, path)));
}
}
check_ref_contracts(check, ROOT, [["branch.md", "base check, naming, and remote prohibition", ["other people's changes", "Do not create a remote branch", "Do not force-move"], 805], ["commit.md", "one reason per commit, repository style, and no push", ["revert only half", "last 20", "Do not push", "--no-verify"], 993], ["daily-wrapup.md", "local evidence draft and explicit destination handoff", ["shared `runtime/work_report.js`", "Publish only when", "local recovery copy"], 1000], ["doctor.md", "three states, no delegated installation, and visible state zero", ["Do not install on the user's behalf", "which exact feature is unavailable", "copy and paste"], 868], ["inspect.md", "layer interpretation, L2 beyond references, and code 1 for no contract", ["Returning 1 for absent contracts is intentional", "incorrect layering", "Do not count only `references/`"], 620], ["install-skill.md", "one exact namespace, visible namespace author and home, same-name refusal until --force, no fabricated plugin entry, a privileged-key warning, and an unreviewed-source notice", ["installs without a further confirmation step", "Show the namespace, the author and the home", "ask before re-running with", "Do not fabricate a marketplace or plugin-cache entry", "A same-named skill with different content is refused", "passed after the user agrees", "jstack does not review it", "stop and ask which skill is meant", "Do not retry with the bare name", "declares `allowed-tools` or `hooks`"], 2630], ["log.md", "topic grouping, reasons, and no invention", ["not comprehension", "reason unknown"], 680], ["pr.md", "review before opening, description fields, the walkthrough offer, and no merge", ["Do not rewrite the diff as prose", "Do not merge on the user's behalf", "ask once per branch", "never start it without a yes", "jstack-walkthrough declined"], 1373], ["ship.md", "ordering, stop on failure, the walkthrough offer, and no push", ["only when the preceding step is green", "gate that exists but does not block is worse", "Do not push or merge", "Do not suggest a bypass", "This is an offer, not a gate", "does not change the verdict", "Never start it without a yes", "jstack-walkthrough"], 1129], ["setup-recall.md", "installation guidance only, three states, and one real stop condition", ["print external installation commands without", "sole exception", "locate a marker without guessing"], 6477], ["skills.md", "read the tree directly and distinguish help's role", ["silently becomes stale", "what exists", "what to use", "use `/install-skill <namespace>`"], 578], ["tidy.md", "three baseline locks, axis order, and invariant behavior", ["directly observed", "Do not change behavior", "Deleting tests to make them green is not cleanup"], 743], ["test-plugin.md", "three exit codes and the danger of zero passing checks", ["A missing check did not pass", "change detector"], 668], ["weekly-wrapup.md", "week boundary, local draft, and destination handoff", ["Monday through Sunday", "local draft", "C/D-style physical addresses"], 1000], ["wrap.md", "unfinished work first and no progress snapshots", ["Record unfinished work first", "Do not store progress status"], 789], ["brainstorming.md", "plan shaping core read first, depth stated, proposal until accepted, and no code", ["Follow the `plan` skill's shaping core: read its brainstorming reference", "Read the repository before asking anything", "do not reopen a design", "It stays a proposal until the user accepts", "Never edit `contract.yaml`"], 897], ["consensus-plan.md", "plan consensus recipe read first, fixed limit, independent assessors, and no execution", ["Follow the `plan` skill's consensus recipe: read its consensus-plan reference", "Fix the alternatives, the criteria and the finite round limit before any", "never present one author's roleplay as consensus", "Synthesize the answers yourself as the plan's only author", "if their isolation cannot be evidenced, return unverified", "converged, pending approval, partial, unavailable, unverified or cancelled", "approval to execute. Never edit `contract.yaml`"], 699]], {label_prefix: "Command contract", subdir: "commands", population: new Set(Array.from(WANT).map((name: any) => ((name + ".md"))))});
(_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "References: /"])))).map((_r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
(_SKIP=["References: /"]);
(_MINE={"runtime/CLI-PATH.md": 3, "commands/branch.md": 9, "commands/commit.md": 10, "commands/daily-wrapup.md": 6, "commands/doctor.md": 10, "commands/inspect.md": 9, "commands/log.md": 8, "commands/pr.md": 10, "commands/ship.md": 11, "commands/skills.md": 8, "commands/tidy.md": 10, "commands/test-plugin.md": 10, "commands/weekly-wrapup.md": 6, "commands/wrap.md": 8, "commands/brainstorming.md": 6, "commands/consensus-plan.md": 6, "commands/install-skill.md": 6});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: _MINE, live_ran: _ran, completeness: false, extra_skip: _SKIP});
(_ALL=({..._MINE, }));
(_ALL["evals/discriminating/audit-priority/case.yaml"]=1);
(_ALL["evals/discriminating/audit-priority/graders/burden.md"]=1);
(_ALL["evals/discriminating/audit-priority/graders/criteria.md"]=1);
(_ALL["evals/discriminating/audit-priority/graders/nit_flood.md"]=1);
(_ALL["evals/discriminating/audit-priority/graders/skill_fired.md"]=1);
(_ALL["evals/discriminating/audit-priority/prompt.md"]=1);
(_ALL["evals/discriminating/cleanup-axes/case.yaml"]=1);
(_ALL["evals/discriminating/cleanup-axes/graders/axis8_exception.md"]=1);
(_ALL["evals/discriminating/cleanup-axes/graders/axis_count.md"]=1);
(_ALL["evals/discriminating/cleanup-axes/graders/criteria.md"]=1);
(_ALL["evals/discriminating/cleanup-axes/graders/skill_fired.md"]=1);
(_ALL["evals/discriminating/cleanup-axes/prompt.md"]=1);
(_ALL["hooks/CONTRACT.md"]=1);
(_ALL["AGENTS.md"]=1);
(_ALL["README.md"]=1);
(_ALL["commands/setup-recall.md"]=1);
(_ALL["contracts/portable-contract.yaml"]=1);
(_ALL["contracts/claims.yaml"]=1);
(_ALL["contracts/change-impact.yaml"]=1);
(_ALL["CHANGELOG.md"]=1);
(_ALL["agents/quality-auditor.md"]=1);
(_ALL["agents/quality-executor.md"]=1);
(_ALL["agents/quality-verifier.md"]=1);
(_ALL["agents/sag-automation-scout.md"]=1);
(_ALL["agents/sag-doc-updater.md"]=1);
(_ALL["agents/sag-duplicate-checker.md"]=1);
(_ALL["agents/sag-followup-suggester.md"]=1);
(_ALL["agents/sag-learning-extractor.md"]=1);
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: _ALL, live_ran: _ran, measure: false, completeness: false, extra_skip: _SKIP});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 210);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, _ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=await main();
