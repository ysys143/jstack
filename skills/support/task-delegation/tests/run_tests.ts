/** Owning behavior and protocol contracts, with measured deletion controls. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const TRIGGERS=["codex한테 맡겨", "codex로 해결", "ask codex", "codex fix", "codex debug", "codex refactor", "codex한테 시켜줘", "코드 수정 위임", "실행 위임", "delegate to codex"];
const SCRIPT=join(ROOT, "scripts", "codex-bridge.js");
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;if(native.timeout!==undefined)native.timeout*=1000;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}

function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function next(values:any[],fallback:any=null):any{return values[0]??fallback;}
function rows(text:any,head:any):any{
let body:any,r:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", body)).filter((r: any) => truth(((!contains(["You are asking for", "Sandbox", "State", "Parameter"], strip(r)))))).map((r: any) => (r));
}
function declared_sandbox_defaults(skill_text:any):any{
let label:any,m:any,out:any,pat:any,sites:any;

(sites=[["sandbox table", "(?m)^\\| `([a-z][a-z-]+)` \\(default\\) \\|"], ["prose", "Default to `([a-z][a-z-]+)`"], ["parameter table", "\\| `--sandbox` \\| No \\| `([a-z][a-z-]+)` \\(default\\)"], ["call example", "\\[--sandbox \\\"([a-z][a-z-]+)\\\"\\]"]]);
(out=[]);
for (let [label, pat] of sites) {
(m=search(pat.replace(/\\(["'])/g,'$1'), skill_text));
if(truth(m)) {
out.push([label, group(m, 1)]);
}
}
return out;
}
function script_sandbox_default(src:string):string|null{return /['"]--sandbox['"]:\s*['"]([a-z-]+)['"]/.exec(src)?.[1]??null;}
function table_cells(text:any,head:any):any{
let body:any,c:any,cells:any,line:any,out:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
(out=[]);
for (let line of lines(body)) {
(line=strip(line));
if(truth(!truth(starts(line, "|")))) {
continue;
}
(cells=Array.from(split(strip(line, "|"), "|")).map((c: any) => (strip(c))));
if(truth((Array.from(cells).map((c: any) => ((compare(new Set(c),new Set("-: "),"<="))))).every((value:any)=>truth(value)))) {
continue;
}
out.push(cells);
}
return slice(out, 1);
}
function mkstub(dirpath:any,name:any,body:any):any{
let f:any,p:any;

(p=join(dirpath, name));
{const f=fileHandle(p,"w");f.write('#!'+process.execPath+'\n'+body);}
chmodSync(p, 493);
return p;
}
function run(args:any,{path,home,extra_env=null,timeout=10,cwd=undefined}:any):any{
let env:any,r:any;

(env={"HOME": home, "PATH": path, "TMPDIR": tmpdir()});
if(truth(extra_env)) {
Object.assign(env,extra_env);
}
(r=subprocessRun([process.execPath, SCRIPT, ...args],{capture_output:true,text:true,env:env,timeout:timeout,cwd:cwd}));
return [r.returncode, r.stdout, r.stderr];
}
function run_probe({path,home,extra_env={}}:any):any{const script='const m=await import('+JSON.stringify(new URL('../scripts/codex-bridge.js',import.meta.url).href)+');process.exit(m.codexProbe());';const r=subprocessRun([process.execPath,'--input-type=module','-e',script],{env:{HOME:home,PATH:path,TMPDIR:tmpdir(),...extra_env},timeout:10});return[r.returncode,r.stdout,r.stderr];}
const SAFE_PATH="/usr/bin:/bin";
function main():any{
let _:any,_c:any,_mktemp_at:any,_trap_at:any,a:any,av:any,av_act:any,av_cells:any,av_mean:any,b:any,bad_tpl:any,c:any,called:any,cap:any,cap_args:any,cap_in:any,cap_lines:any,cap_pairs:any,capture:any,capture_in:any,ct:any,ct_map:any,cwd_dir:any,decl:any,decl_values:any,desc:any,err:any,f:any,fm:any,fm_bytes:any,ghost:any,home:any,home2:any,idir:any,ilog:any,k:any,m_doc_to:any,m_scr_to:any,missing_skills:any,missing_tr:any,n:any,named:any,names:any,ok:any,out:any,pairs:any,passed:any,passed_dir:any,perr_absent:any,prc_absent:any,prc_full:any,prc_partial:any,pt:any,pt_cells:any,r:any,rc:any,ref:any,req:any,sb:any,sb_map:any,script_default:any,script_src:any,skill:any,stubdir:any,t:any,tdir:any,tool:any,tpls:any,tr:any,trace:any,v:any,wdir:any,wl:any,wp:any,wrapper:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(script_src=read(SCRIPT));
check("Invocation: description says both execution and not a second opinion", ((value:any)=>truth(value)?((contains(fm, "not a second opinion"))):value)(((contains(fm, "actually executes and writes code")))));
(ct=rows(skill, "## The calling moment decides which skill"));
check("Invocation: comparison table has three rows", (isDeepStrictEqual(length(ct),3)), (pyStr(length(ct)) + " rows"));
(ct_map=Object.fromEntries(Array.from(table_cells(skill, "## The calling moment decides which skill")).filter((c: any) => truth((isDeepStrictEqual(length(c),2)))).map((c: any) => ([at(c, 1), at(c, 0)]))));
check("Comparison table: each row maps to its correct skill", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains((ct_map["`bridge`"] ?? ""), "probing and calling an external tool"))):value)(((contains((ct_map["`delegate`"] ?? ""), "files edited, under a sandbox and workdir you name")))):value)(((contains((ct_map["`consult`"] ?? ""), "possibly one that disagrees")))), (pyStr(sorted(ct_map))));
check("Invocation: defines keeping the artifact while seeking a verdict", ((contains(skill, "keeps the artefact in\nyour hands and asks for a verdict"))));
check("Invocation: defines handing off the artifact", ((contains(skill, "gives the artefact away"))));
check("Invocation: says the consult prism does not apply to delegate", ((value:any)=>truth(value)?((contains(skill, "so it does not apply"))):value)(((contains(skill, "does not review, does not average")))));
check("Execution: says Codex resolves ambiguity because there is no follow-up turn", ((contains(skill, "Codex fills the gap itself rather than asking"))));
(sb=rows(skill, "## What actually happens when you delegate"));
check("Sandbox: table has three rows", (isDeepStrictEqual(length(sb),3)), (pyStr(length(sb)) + " rows"));
(sb_map=Object.fromEntries(Array.from(table_cells(skill, "## What actually happens when you delegate")).filter((c: any) => truth((isDeepStrictEqual(length(c),2)))).map((c: any) => ([at(c, 0), at(c, 1)]))));
check("Sandbox table: each value maps to its allowed scope", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual((sb_map["`danger-full-access`"] ?? null),"Write anywhere the process can reach")):value)((isDeepStrictEqual((sb_map["`workspace-write`"] ?? null),"Write inside `--workdir`"))):value)(((contains((sb_map["`read-only` (default)"] ?? ""), "cannot write")))), (pyStr(sorted(sb_map))));
check("Sandbox: pins the default to read-only", ((contains(skill, "Default to `read-only`"))));
check("Sandbox: describes the concrete risk of excessive elevation", ((contains(skill, "outside the one directory"))));
(decl=declared_sandbox_defaults(skill));
(decl_values=new Set(Array.from(decl).map(([_, v]: any) => (v))));
check("Document-script parity: all four documented sandbox defaults agree", ((value:any)=>truth(value)?(isDeepStrictEqual(length(decl_values),1)):value)((isDeepStrictEqual(length(decl),4))), (pyStr(decl)));
(script_default=script_sandbox_default(script_src));
check("Document-script parity: script SANDBOX default matches the documented value", ((value:any)=>truth(value)?(isDeepStrictEqual(decl_values,new Set([script_default]))):value)(((script_default !== null))), ("script " + pyStr(script_default) + " / document " + pyStr(sorted(decl_values))));
check("Call site: gives the exact path through CLAUDE_PLUGIN_ROOT", ((contains(skill, "${JSTACK_PLUGIN_ROOT}/skills/delegate/scripts/codex-bridge.js"))));
check("Call site: says no discovery step is needed", ((contains(skill, "No search step is needed"))));
check("Call site: forbids hardcoding ~/.claude/plugins", ((contains(skill, "Do not hardcode a\npath under `~/.claude/plugins`"))));
check("Call site: identifies hardcoding as the mistake the script rules out", ((contains(skill, "it is the one\nmistake this script is built to rule out"))));
(m_doc_to=search("Seconds before the process is killed \\(default (\\d+)", skill));
(m_scr_to=search("['\"]--timeout['\"]:\\s*['\"](\\d+)['\"]", script_src));
check("Document-script parity: timeout defaults match in document and script", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(group(m_doc_to, 1),group(m_scr_to, 1))):value)(((m_scr_to !== null))):value)(((m_doc_to !== null))), ("document " + pyStr(((value:any)=>truth(value)?group(m_doc_to, 1):value)(m_doc_to)) + " / script " + pyStr(((value:any)=>truth(value)?group(m_scr_to, 1):value)(m_scr_to))));
(pt=rows(skill, "## Running it"));
check("Parameter table: has six rows for prompt, sandbox, workdir, model, files, and timeout", (isDeepStrictEqual(length(pt),6)), (pyStr(length(pt)) + " rows"));
(pt_cells=Array.from(table_cells(skill, "## Running it")).filter((c: any) => truth((isDeepStrictEqual(length(c),3)))).map((c: any) => (c)));
(req=Object.fromEntries(Array.from(pt_cells).map((c: any) => ([at(c, 0), at(c, 1)]))));
(desc=Object.fromEntries(Array.from(pt_cells).map((c: any) => ([at(c, 0), at(c, 2)]))));
check("Parameter table: only --prompt is required", ((value:any)=>truth(value)?(isDeepStrictEqual(Array.from(["`--sandbox`", "`--workdir`", "`--model`", "`--files`", "`--timeout`"]).map((k: any) => ((req[k] ?? null))),Array(5).fill("No"))):value)((isDeepStrictEqual((req["`--prompt`"] ?? null),"Yes"))), (pyStr(req)));
check("Parameter table: each row has its key cells in place", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains((desc["`--timeout`"] ?? ""), "default 300"))):value)(((contains((desc["`--files`"] ?? ""), "Comma-separated paths inlined into the prompt")))):value)(((contains((desc["`--model`"] ?? ""), "Model override")))):value)(((contains((desc["`--workdir`"] ?? ""), "defaults to the caller's `pwd`")))):value)((isDeepStrictEqual((desc["`--sandbox`"] ?? null),"`read-only` (default), `workspace-write`, `danger-full-access`"))):value)(((contains((desc["`--prompt`"] ?? ""), "no follow-up turn")))), (pyStr(sorted(desc))));
check("Availability: says it follows the bridge three-state contract", ((contains(skill, "following the convention `bridge` defines"))));
(av=rows(skill, "## Availability — three states, no installs"));
check("Availability table: has three rows", (isDeepStrictEqual(length(av),3)), (pyStr(((value:any)=>truth(value)?length(av):value)(av)) + " rows"));
(av_cells=Array.from(table_cells(skill, "## Availability — three states, no installs")).filter((c: any) => truth((isDeepStrictEqual(length(c),3)))).map((c: any) => (c)));
(av_mean=Object.fromEntries(Array.from(av_cells).map((c: any) => ([at(c, 0), at(c, 1)]))));
(av_act=Object.fromEntries(Array.from(av_cells).map((c: any) => ([at(c, 0), at(c, 2)]))));
check("Availability table: each state means a distinct condition", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains((av_mean["2 — blocked"] ?? ""), "does not resolve on `PATH`"))):value)(((contains((av_mean["1 — partial"] ?? ""), "no `OPENAI_API_KEY` and no `~/.codex/auth.json`")))):value)(((contains((av_mean["0 — full"] ?? ""), "credentials are present")))), (pyStr(sorted(av_mean))));
check("Availability table: action differs by state and only state 2 shows installation", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains((av_act["2 — blocked"] ?? ""), "Prints the exact install command"))):value)(((!contains((av_act["1 — partial"] ?? ""), "install")))):value)(((contains((av_act["1 — partial"] ?? ""), "without authentication")))):value)((isDeepStrictEqual((av_act["0 — full"] ?? null),"Says nothing, proceeds"))), (pyStr(sorted(av_act))));
check("Availability: distinguishes state 1 unauthenticated from state 2 absent", ((value:any)=>truth(value)?((contains(skill, "does not resolve on `PATH`"))):value)(((contains(skill, "no `OPENAI_API_KEY` and no `~/.codex/auth.json`")))));
check("Availability: explains why the two states must not share a message", ((contains(skill, "sends them to fix the wrong\nthing"))));
check("Availability: says installation appears only for state 2", ((contains(skill, "Only state 2 prints an install command"))));
check("Boundary: says consult does not touch files", ((contains(skill, "it never\ntouches a file"))));
check("Boundary: says bridge owns the general contract and delegate implements it", ((value:any)=>truth(value)?value:((contains(skill, "implements for one\nspecific tool"))))(((contains(skill, "implements for one")))));
check("Boundary: distinguishes codex-rescue diagnosis and retry from delegate", ((value:any)=>truth(value)?((contains(skill, "does not diagnose or\nretry"))):value)(((contains(skill, "diagnoses why a Codex run went wrong")))));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing_skills=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("Boundary: handoff population is nonempty", (compare(length(named),2,">=")), (pyStr(sorted(named))));
check("Boundary: every handoff target exists", !truth(missing_skills), ("absent " + pyStr(missing_skills)));
check("Language: description has Korean triggers", (compare(length(findall("[가-힣]+", fm)),5,">=")));
check("Language: description has English triggers", ((value:any)=>truth(value)?((contains(fm, "\"delegate to codex\""))):value)(((contains(fm, "\"ask codex\"")))));
(missing_tr=Array.from(TRIGGERS).filter((t: any) => truth(((!contains(fm, ("\"" + pyStr(t) + "\"")))))).map((t: any) => (t)));
check("Frontmatter: all ten trigger phrases survive literally", !truth(missing_tr), ("missing " + pyStr(missing_tr)));
(fm_bytes=content_bytes(fm, TRIGGERS));
check("Frontmatter: execution boundary remains explicit",fm.includes("not a second opinion"));
check("L0: description includes the codex-rescue boundary phrase", ((value:any)=>truth(value)?((contains(skill, "when specifying the working directory, sandbox, and model"))):value)(((contains(skill, "codex:codex-rescue")))));
check("L0: description includes the invocation flag set", ((contains(skill, "`--sandbox`/`--workdir`/`--model`"))));
check("Installation: the script never installs anything", !truth(search("(?m)^\\s*(brew|apt|npm|pip3?|uv|cargo)\\s+install", script_src)));
check("Installation: script contains the absent-state installation command", ((contains(script_src, "npm install -g @openai/codex"))));
{const home=temporaryDirectory();try{const bin=join(home,'bin');mkdirSync(bin);mkstub(bin,'codex',"process.stdout.write('ONLY_OUTPUT\\n');process.stderr.write('ONLY_DIAGNOSTIC\\n');");const env={path:bin,home,extra_env:{OPENAI_API_KEY:'stub'}};const first=run(['--prompt','first'],env),second=run(['--prompt','second'],env);check('Transport: successful stdout contains only model output',first[0]===0&&first[1]==='ONLY_OUTPUT\n',pyStr(first));check('Transport: repeated calls do not retain prior output',second[0]===0&&second[1]===first[1],pyStr(second));check('Transport: output capture leaves no temporary files',readdirSync(home).sort().join(',')==='bin'&&readdirSync(bin).join(',')==='codex',pyStr(readdirSync(home)));}finally{removeTree(home);}}
{const home=temporaryDirectory();const stubdir=temporaryDirectory();try{([rc, out, err]=run(["--prompt", "x"],{path:SAFE_PATH,home:home}));
check("Runtime: absent Codex returns rc 1", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
check("Runtime: absent state prints the full installation command", ((contains(err, "npm install -g @openai/codex"))), slice(strip(err), 0, 80));
check("Runtime: absent state says not found, distinct from unauthenticated", ((contains(err, "was not found"))), slice(strip(err), 0, 80));
mkstub(stubdir, "codex", "console.log(\"should-not-run\");process.exitCode=0;");
([rc, out, err]=run(["--prompt", "x"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home}));
check("Runtime: present but unauthenticated returns rc 1", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
check("Runtime: unauthenticated state prints authentication guidance, not install", ((value:any)=>truth(value)?((!contains(err, "npm install"))):value)(((contains(err, "unauthenticated")))), slice(strip(err), 0, 80));
check("Runtime: unauthenticated stub is never executed because probe blocks first", ((!contains(out, "should-not-run"))));
(home2=temporaryDirectory());
try {mkdirSync(join(home2, ".codex"),{recursive:true});
{const f=fileHandle(join(home2, ".codex", "auth.json"),"w");f.write("{}");}
mkstub(stubdir, "codex", "require('node:fs').readFileSync(0);console.log(\"ok\");process.exitCode=0;");
([rc, out, err]=run(["--prompt", "x"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home2}));
check("Runtime: auth.json alone counts as authenticated and passes probe", ((!contains(err, "unauthenticated"))), slice(strip(err), 0, 80));}finally{removeTree(home2, {ignore_errors: true});}
mkstub(stubdir, "codex", "process.exitCode=0;");
([prc_absent, _, perr_absent]=run_probe({path:SAFE_PATH,home:home}));
([prc_partial, _, _]=run_probe({path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home}));
([prc_full, _, _]=run_probe({path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: probe returns 2 for absent, distinct from unauthenticated 1", (isDeepStrictEqual(prc_absent,2)), ("rc=" + pyStr(prc_absent)));
check("Runtime: probe returns 1 for present but unauthenticated", (isDeepStrictEqual(prc_partial,1)), ("rc=" + pyStr(prc_partial)));
check("Runtime: probe returns 0 for a healthy state", (isDeepStrictEqual(prc_full,0)), ("rc=" + pyStr(prc_full)));
check("Runtime: healthy probe state is silent", (isDeepStrictEqual(at(run_probe({path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}), 2),"")), "stderr must be empty in the healthy state");
(idir=temporaryDirectory());
try {(ilog=join(idir, "install-calls.txt"));
for (let tool of ["npm", "brew", "pip3", "apt-get", "cargo"]) {
mkstub(idir,tool,"require('node:fs').appendFileSync("+JSON.stringify(ilog)+",JSON.stringify(process.argv.slice(2)));");
}
([rc, out, err]=run(["--prompt", "x"],{path:(pyStr(idir) + ":" + pyStr(SAFE_PATH)),home:home}));
(called=(truth(existsSync(ilog)) ? read(ilog) : ""));
check("Runtime: absent state never executes an installation tool", (isDeepStrictEqual(called,"")), pyStr(slice(called, 0, 120)));
check("Runtime: installation command is printed only, never executed", ((value:any)=>truth(value)?((contains(err, "npm install -g @openai/codex"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 80))));}finally{removeTree(idir, {ignore_errors: true});}
([rc, out, err]=run([],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: authenticated execution passes probe and reaches argument validation", ((value:any)=>truth(value)?((contains(err, "--prompt is required"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 60))));
(capture=join(home, "capture.txt"));
(capture_in=join(home, "capture-stdin.txt"));
mkstub(stubdir,'codex',`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(capture)},process.argv.slice(2).join('\\n')+'\\n');fs.writeFileSync(${JSON.stringify(capture_in)},fs.readFileSync(0));process.stdout.write("\\u001b[31mHELLO\\u001b[0m  \\n");`);
([rc, out, err]=run(["--prompt", "Fix the bug", "--workdir", "/tmp"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: successful execution returns rc 0", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 80))));
check("Runtime: strips ANSI escape sequences", ((value:any)=>truth(value)?((contains(out, "HELLO"))):value)(((!contains(out, "\u001b[")))), pyStr(out));
check("Runtime: trims leading and trailing whitespace from each line", (isDeepStrictEqual(strip(out),"HELLO")), pyStr(out));
function read_capture():any{
let f:any;
if(truth(!truth(existsSync(capture)))) {
return "";
}
{const f=fileHandle(capture,"r");return f.read();}
}
function read_stdin():any{
let f:any;
if(truth(!truth(existsSync(capture_in)))) {
return "";
}
{const f=fileHandle(capture_in,"r");return f.read();}
}
(cap=read_capture());
(cap_args=lines(cap));
(cap_pairs=Array.from(zip(cap_args, slice(cap_args, 1))));
check("Runtime: omitted --sandbox passes read-only by default", ((contains(cap_pairs, ["-s", "read-only"]))), slice(cap_args, 0, 10));
check("Runtime: omitted --sandbox never elevates to a writable sandbox", ((value:any)=>truth(value)?((!contains(cap, "danger-full-access"))):value)(((!contains(cap, "workspace-write")))), slice(cap, 0, 120));
check("Runtime: always adds --skip-git-repo-check", ((contains(cap, "--skip-git-repo-check"))), slice(cap, 0, 160));
check("Runtime: passes workdir through -C", ((contains(cap, "/tmp"))), slice(cap, 0, 160));
(cap_in=read_stdin());
check("Runtime: passes prompt through stdin", ((contains(cap_in, "Fix the bug"))), slice(cap_in, -(160)));
check("Runtime: prompt is absent from argv to avoid quoting problems", ((!contains(cap, "Fix the bug"))), slice(cap, 0, 160));
check("Runtime: passes stdin marker as the prompt argument", (isDeepStrictEqual(slice(cap_args, -(1)),["-"])), slice(cap_args, -(3)));
for (let _c of [capture, capture_in]) {
if(truth(existsSync(_c))) {
rmSync(_c);
}
}
([rc, out, err]=run(["--prompt", "x", "--model", "o3", "--sandbox", "read-only"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
(cap_lines=lines(read_capture()));
(pairs=Array.from(zip(cap_lines, slice(cap_lines, 1))));
check("Runtime: passes --model through -m", ((contains(pairs, ["-m", "o3"]))), slice(cap_lines, 0, 10));
check("Runtime: passes --sandbox override through -s", ((contains(pairs, ["-s", "read-only"]))), slice(cap_lines, 0, 10));
for (let _c of [capture, capture_in]) {
if(truth(existsSync(_c))) {
rmSync(_c);
}
}
(ref=join(home, "ref.py"));
{const f=fileHandle(ref,"w");f.write("def broken(): pass\n");}
([rc, out, err]=run(["--prompt", "review", "--files", ref],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
(cap_in=read_stdin());
check("Runtime: inlines --files content into the prompt", ((value:any)=>truth(value)?((contains(cap_in, "FILE:"))):value)(((contains(cap_in, "def broken(): pass")))), slice(cap_in, -(200)));
for (let _c of [capture, capture_in]) {
if(truth(existsSync(_c))) {
rmSync(_c);
}
}
(ghost=join(home, "no-such-file.py"));
([rc, out, err]=run(["--prompt", "review", "--files", (pyStr(ref) + "," + pyStr(ghost))],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: missing --files path warns and names that path", ((value:any)=>truth(value)?((contains(err, ghost))):value)(((contains(err, "WARNING: File not found")))), slice(strip(err), 0, 120));
check("Runtime: existing files are still inlined when another path is missing", ((value:any)=>truth(value)?((contains(read_stdin(), "def broken(): pass"))):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc)));
for (let _c of [capture, capture_in]) {
if(truth(existsSync(_c))) {
rmSync(_c);
}
}
mkstub(stubdir, "codex", "require('node:fs').readFileSync(0);process.exitCode=124;");
([rc, out, err]=run(["--prompt", "x", "--timeout", "7"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: rc 124 becomes rc 1 with a timeout message", ((value:any)=>truth(value)?((contains(err, "timed out after 7s"))):value)((isDeepStrictEqual(rc,1))), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 80))));
check("Runtime: timeout is not reported as exit code 124", ((!contains(err, "exited with code 124"))), slice(strip(err), 0, 80));
for(const wrapper of ['timeout','gtimeout']){const wdir=temporaryDirectory();try{const trace=join(wdir,'wrapper-used');mkstub(wdir,wrapper,"require('node:fs').writeFileSync("+JSON.stringify(trace)+",'used');");mkstub(wdir,'codex',"require('node:fs').readFileSync(0);setTimeout(()=>console.log('late'),1000);");const [rc,,err]=run(['--prompt','x','--timeout','0.05'],{path:wdir,home,extra_env:{OPENAI_API_KEY:'stub'}});check('Runtime: native timeout works independently of '+wrapper,rc===1&&err.includes('timed out after 0.05s')&&!existsSync(trace),err);}finally{removeTree(wdir);}}
for (let _c of [capture, capture_in]) {
if(truth(existsSync(_c))) {
rmSync(_c);
}
}
mkstub(stubdir,'codex',`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(capture)},process.argv.slice(2).join('\\n')+'\\n');fs.writeFileSync(${JSON.stringify(capture_in)},fs.readFileSync(0));process.stdout.write("ok\\n");`);
(cwd_dir=temporaryDirectory());
try {([rc, out, err]=run(["--prompt", "x"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,cwd:cwd_dir,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
(wl=lines(read_capture()));
(wp=Array.from(zip(wl, slice(wl, 1))));
(passed_dir=next(Array.from(wp).filter(([a, b]: any) => truth((isDeepStrictEqual(a,"-C")))).map(([a, b]: any) => (b)), null));
check("Runtime: omitted --workdir passes caller pwd through -C", ((contains([cwd_dir, realpathSync(cwd_dir)], passed_dir))), (pyStr(passed_dir) + " / pwd " + pyStr(cwd_dir)));}finally{removeTree(cwd_dir, {ignore_errors: true});}
mkstub(stubdir, "codex", "require('node:fs').readFileSync(0);console.error(\"boom\");process.exitCode=3;");
([rc, out, err]=run(["--prompt", "x"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: abnormal Codex exit returns rc 1 and reports its code", ((value:any)=>truth(value)?((contains(err, "exited with code 3"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 100));
check("Runtime: forwards Codex stderr unchanged", ((contains(err, "boom"))), slice(strip(err), 0, 100));
mkstub(stubdir, "codex", "require('node:fs').readFileSync(0);process.exitCode=0;");
([rc, out, err]=run(["--prompt", "x"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: empty output returns rc 1 and reports it", ((value:any)=>truth(value)?((contains(err, "empty output"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
mkstub(stubdir, "codex", "console.log(\"should-not-run\");");
([rc, out, err]=run(["--prompt", "x", "--bogus", "y"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home,extra_env:{"OPENAI_API_KEY": "sk-test"}}));
check("Runtime: unknown flag returns rc 1 and names the flag", ((value:any)=>truth(value)?((contains(err, "Unknown option: --bogus"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));for(const [label,options] of [['invalid sandbox',['--sandbox','unrestricted']],['non-numeric timeout',['--timeout','NaN']],['non-positive timeout',['--timeout','0']]] as [string,string[]][]){const marker=join(home,'invalid-request-invoked');rmSync(marker,{force:true});mkstub(stubdir,'codex',"require('node:fs').writeFileSync("+JSON.stringify(marker)+",'invoked');console.log('unexpected');");const [code,,error]=run(['--prompt','x',...options],{path:stubdir,home,extra_env:{OPENAI_API_KEY:'stub'}});check('Runtime: '+label+' is rejected before invoking Codex',code===1&&error.length>0&&!existsSync(marker),`exit=${code} ${error}`);}
}finally{removeTree(stubdir);removeTree(home);}}
check_skill_body(check, ROOT, {semantic: true, needles: ["keeps the artefact in\nyour hands and asks for a verdict", "gives the artefact away", "does not review, does not average", "a reduced path that does not\nsay it is reduced", "does not diagnose or\nretry"], floor: 4594});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 39, "scripts/codex-bridge.js": 37}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 39, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/codex-bridge.js": 37}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 101);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
