/** Owning behavior and protocol contracts, with measured deletion controls. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync,copyFileSync,renameSync,lstatSync,symlinkSync,realpathSync,chmodSync} from 'node:fs';
import {dirname,basename,join,relative,sep,delimiter} from 'node:path';
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

const PROBE=join(ROOT, "scripts", "probe.js");
const INSTALL=join(ROOT, "scripts", "install.js");
const RULES_JSON=join(ROOT, "scripts", "rules.json");
const PACKAGE_ROOT=dirname(SKILLS);
const SOURCE_HOOK=join(PACKAGE_ROOT, "hosts", "claude", "hooks", "validate_pr_label.js");
const BUILT_HOOK=join(PACKAGE_ROOT, "hooks", "validate_pr_label.js");
const HOOK=(truth(isfile(SOURCE_HOOK)) ? SOURCE_HOOK : BUILT_HOOK);
const FM="---\nname: {n}\ndescription: {n} description\n---\n\n{b}\n";
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;if(native.timeout!==undefined)native.timeout*=1000;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}


function islink(path:string):boolean{try{return lstatSync(path).isSymbolicLink();}catch{return false;}}
function lexists(path:string):boolean{try{lstatSync(path);return true;}catch{return false;}}
function fmFormat(values:Record<string,string>):string{return FM.replace(/\{([nb])\}/g,(_,key)=>values[key]);}
function shellWords(text:string):string[]{const out:string[]=[];let word='',quote='',started=false;for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c===quote){quote='';continue;}if(c==='\\'&&quote==='"'){word+=text[++i]??'';continue;}word+=c;continue;}if(c==='"'||c==="'"){quote=c;started=true;}else if(c==='\\'){word+=text[++i]??'';started=true;}else if(/\s/.test(c)){if(started){out.push(word);word='';started=false;}}else{word+=c;started=true;}}if(quote)throw Error('Unclosed quote');if(started)out.push(word);return out;}

function rows(text:any,head:any):any{
let body:any,r:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", body)).filter((r: any) => truth(((!contains(["Exit", "Check", "State"], strip(r)))))).map((r: any) => (r));
}
function probe(...input:any[]):any{
const options=typeof input.at(-1)==='object'?input.pop():{};const args=input;const {path_extra=null}=options;
let env:any,r:any;

(env=({...process.env, }));
if(truth(path_extra)) {
(env["PATH"]=((path_extra + delimiter) + at(env, "PATH")));
}
(r=subprocessRun([process.execPath, PROBE, ...args],{capture_output:true,text:true,env:env}));
return [r.returncode, r.stdout];
}
function stub(tmp:any,name:any,version_line:any):any{
let f:any,p:any;

(p=join(tmp, name));
{const f=fileHandle(p,"w");f.write('#!'+process.execPath+'\nconsole.log('+JSON.stringify(version_line)+');');}
chmodSync(p, 493);
return tmp;
}
function _compiles(pattern:any):any{
try {new RegExp(pattern);
return true;}catch(error){return false;}
}
function read_or_empty(p:any):any{
let f:any;

try {{const f=fileHandle(p,"r");return f.read();}}catch(error){return "";}
}
function marketplace(tmp:any,skills:any,{with_marker=true,depth=['staging','jstack-dev'],owner='bridge',extra=null,marker_rel=null}:any={}):any{
let body:any,bs:any,codex:any,d:any,f:any,files:any,fn:any,mp:any,name:any,plug:any,rel:any,root:any;

(root=join(tmp, "mkt"));
(plug=join(root, ...depth));
for (let [name, body] of Object.entries(skills)) {
(d=join(plug, "skills", name));
mkdirSync(d,{recursive:true});
{const f=fileHandle(join(d, "SKILL.md"),"w");f.write(String(body));}
}
for (let [name, files] of Object.entries(((value:any)=>truth(value)?value:{})(extra))) {
(d=join(plug, "skills", name));
mkdirSync(d,{recursive:true});
for (let [fn, body] of Object.entries(files as Record<string,any>)) {
{const f=fileHandle(join(d, fn),"w");f.write(String(body));}
}
}
(bs=join(plug, "skills", owner, "scripts"));
mkdirSync(bs,{recursive:true});
copyFileSync(INSTALL,join(bs,'install.js'));mkdirSync(join(plug,'runtime'),{recursive:true});copyFileSync(join(PACKAGE_ROOT,'runtime/entry.js'),join(plug,'runtime/entry.js'));writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
copyFileSync(RULES_JSON,join(bs,'rules.json'));
if(truth(with_marker)) {
(rel=((value:any)=>truth(value)?value:join(".claude-plugin", "marketplace.json"))(marker_rel));
(mp=join(root, ...split(replace(rel, "\\", "/"), "/")));
mkdirSync(dirname(mp),{recursive:true});
{const f=fileHandle(mp,"w");f.write(JSON.stringify({"name": "t", "plugins": [{"name": "jstack-dev", "source": ("./" + joinText("/", depth))}]}));}
}
(codex=join(tmp, "codex"));
mkdirSync(join(codex, "skills"),{recursive:true});
return [root, join(bs, "install.js"), codex];
}
function install(script:any,codex:any,...args:any[]):any{
let r:any;

(r=subprocessRun([({executable:process.execPath}).executable, script, "--codex-home", codex, ...args],{capture_output:true,text:true}));
return [r.returncode, r.stdout];
}
const INSTALL_PATTERNS=["\\b(brew|apt|apt-get|dnf|yum|pacman|apk|port|snap|choco|winget|npm|pnpm|yarn|pip|pip3|uv|cargo|gem|nix-env|asdf|mise)\\b[^\\n]{0,24}\\b(install|reinstall)\\b", "\\b(npm|pnpm|yarn)\\s+(i|add)\\b", "\\bsudo\\b[^\\n]{0,24}\\binstall\\b", "\\b(curl|wget)\\b[^\\n|]*\\|\\s*(ba|z)?sh\\b"];
function installs_here(text:any):any{
let m:any,p:any;

return Array.from(INSTALL_PATTERNS).flatMap((p: any) => Array.from(finditer(p, text)).map((m: any) => (group(m, 0))));
}
function says(text:any,sentence:any):any{

return ((contains(joinText(" ", split(text)), joinText(" ", split(sentence)))));
}
function table(text:any,head:any):any{
let body:any,c:any,line:any,out:any,t:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
(out=[]);
for (let line of lines(body)) {
(t=strip(line));
if(truth(((value:any)=>truth(value)?value:(compare(new Set(t),new Set("|- "),"<=")))(!truth(starts(t, "|"))))) {
continue;
}
out.push(Array.from(split(strip(t, "|"), "|")).map((c: any) => (strip(c))));
}
return slice(out, 1);
}
function literal_of(pattern:any):any{
let alt:any,lit:any;

(alt=at(split(pattern, "|"), 0));
(lit=sub("\\(\\?<[=!][^)]*\\)", "", alt));
(lit=sub("\\\\(.)", "\\1", lit));
return (truth(((value:any)=>truth(value)?search("(?s)"+pattern,lit):value)(lit)) ? lit : null);
}
const EXPECT_BLOCKERS=["Task\\(", "subagent_type", "AskUserQuestion", "ExitPlanMode|EnterPlanMode", "mcp__claude|claude-in-chrome", "oh-my-claudecode"];
const EXPECT_SUBS=[["CLAUDE\\.md", "AGENTS.md"], ["~/\\.claude/settings\\.local\\.json", "~/.codex/config.toml"], ["~/\\.claude/settings\\.json", "~/.codex/config.toml"], ["\\.claude/settings\\.local\\.json", "~/.codex/config.toml"], ["\\.claude/settings\\.json", "~/.codex/config.toml"], ["~/\\.claude/skills", "~/.codex/skills"], ["~/\\.claude/plugins", "~/.codex/plugins"], ["`skillOverrides`", "`[[skills.config]]` (config.toml, path + enabled)"], ["`/plugin`", "`config.toml` 의 `[plugins.\"<name>\"]`"], ["/plugin marketplace add", "config.toml 의 [marketplaces.*] 항목 추가"], ["(?<!Generated with )Claude Code", "Codex"], ["Claude가 ", "Codex가 "], ["Claude는 ", "Codex는 "]];
function install_block(rec:any):any{
let body:any,line:any,out:any,parts:any,t:any;

if(truth(((!contains(rec, "**Install (state 2)**"))))) {
return [];
}
(parts=split(at(split(rec, "**Install (state 2)**", 1), 1), "```"));
(body=(truth((compare(length(parts),1,">"))) ? at(parts, 1) : ""));
(out=[]);
for (let line of lines(body)) {
(t=strip(at(split(line, "#"), 0)));
if(truth(((value:any)=>truth(value)?(!isDeepStrictEqual(t,"bash")):value)(t))) {
out.push(t);
}
}
return out;
}
function lock_of(codex:any):any{
let f:any,p:any;

(p=join(codex, "skills", ".jstack-bridge.json"));
try {{const f=fileHandle(p,"r");return JSON.parse(f.read());}}catch(error){return {};}
}
function counted(out:any,label:any):any{
let m:any;

(m=search((label + "\\s+(\\d+)"), out));
return (truth(m) ? Number(group(m, 1)) : -(1));
}
function main():any{
let _:any,_all_out:any,_r:any,_r1o:any,_reinstall_out:any,_root:any,_space_out:any,_to:any,a:any,absent_out:any,absent_rc:any,after:any,all_rc:any,args:any,b:any,b_dst:any,b_record:any,bad:any,base:any,bdir:any,blocked_dir:any,blocked_out:any,blocked_rc:any,blockers:any,body:any,broken:any,built_native:any,c:any,caught:any,ch:any,claim:any,cmds:any,codex:any,collision_out:any,collision_rc:any,commands:any,coverage:any,cross:any,d:any,d9:any,dM:any,dd:any,ddir:any,dep2_out:any,dep2_rc:any,dep_dst:any,dep_out:any,dep_rc:any,dest:any,digest1:any,digest2:any,dm:any,doc_refuses:any,doc_states:any,domain_out:any,domain_rc:any,drift:any,dst:any,dst_g:any,dy:any,e1:any,exported:any,f:any,fm:any,foreign:any,frm:any,gh_t:any,gitr:any,got:any,gsrc:any,guide:any,head1:any,head3:any,hit:any,hook_src:any,i:any,installed:any,java:any,k:any,keep_out:any,keep_rc:any,left:any,lg:any,line:any,lit:any,live_refuses:any,lock1:any,lock_path:any,marker:any,marker_path:any,missing:any,mk_out:any,mk_rc:any,n:any,name:any,named:any,native:any,o0:any,o1:any,o2:any,ok:any,only_out:any,only_rc:any,out:any,out_auth_ok:any,ov:any,ov_out:any,ov_rc:any,p:any,passed:any,pat:any,ph:any,ph_t:any,plainr:any,planted:any,plug:any,probe_src:any,pt:any,py_run:any,quiet:any,r:any,r1c:any,r2c:any,r2o:any,r3c:any,r3o:any,r4c:any,r4o:any,rc:any,rc0:any,rc1:any,rc2:any,rc_auth_ok:any,rdest:any,rec:any,rec1:any,rec3:any,recover_out:any,recover_rc:any,refdir:any,reinstall_rc:any,root:any,rules:any,rules_out:any,rules_raw:any,rules_rc:any,s:any,script:any,sh_run:any,sh_t:any,shared:any,si:any,skill:any,skill_dir:any,source_native:any,space_rc:any,spaced_root:any,speaks:any,st:any,strip_time:any,subs:any,tmp:any,to:any,tool_dir:any,user_out:any,user_rc:any,v:any,w:any,why:any,x:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(rec=read(join(ROOT, "references", "probe-recipes.md")));
(probe_src=read(PROBE));
(st=rows(skill, "## Three states, not two"));
check("Status: exit code table has three rows", (isDeepStrictEqual(length(st),3)), (pyStr(length(st)) + " rows"));
check("Status: Boolean flagged as wrong shape", ((contains(skill, "\"Installed or not\" is the wrong shape"))));
check("Status: Gives a real-world example of partial availability", ((value:any)=>truth(value)?value:((contains(skill, "runtime is missing"))))(((contains(skill, "not authenticated")))));
check("Status: Code 1 Identifies the reason for the existence of this protocol", ((contains(skill, "Code 1 is the one that earns the convention"))));
check("Status: Reveal what Boolean hides", ((contains(skill, "exactly which capability is missing"))));
check("Installation: Instead, they criticize you for not installing it.", ((contains(skill, "Never install on the user's behalf"))));
check("Installation: Instructs to print commands but not execute them", ((contains(skill, "Print the command; do not run it"))));
check("Installation: Reveal rationale (machine change not scoped by session)", ((contains(skill, "this session did not scope"))));
check("Installation: Guidance without commands is not guidance.", ((value:any)=>truth(value)?says(skill, "Guidance that says \"install X\" without the command is not guidance."):value)(says(skill, "The output on exit 2 is the install command, in full, ready to paste.")));
(hit=installs_here(probe_src));
check("Installation: No installation execution in script (pattern set)", !truth(hit), (pyStr(hit)));
(hit=installs_here(skill));
check("Installation: There is no installation command in the text (voice needle)", !truth(hit), (pyStr(hit)));
(caught=Array.from(["uv tool install x", "npm i -g x", "sudo dnf install x", "brew reinstall x", "curl -fsSL u | sh"]).filter((p: any) => truth(!truth(installs_here(p)))).map((p: any) => (p)));
check("Install: pattern set catches five real install forms", !truth(caught), ("missed " + pyStr(caught)));
([rc, out]=probe("definitely-not-a-real-binary-xyz","--install","brew install example"));
check("Actual measurement: Absence is code 2", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
check("Actual measurement: Code 2 prints the full text of the installation command", ((contains(out, "brew install example"))), strip(out));
([rc, out]=probe(process.execPath));
check("Ground truth: Available is code 0", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
check("Actual measurement: Code 0 outputs nothing", (isDeepStrictEqual(strip(out),"")), pyStr(out));
([rc, out]=probe(process.execPath,"--auth",JSON.stringify(process.execPath)+' -e "process.exit(1)"'));
check("Actual measurement: No authentication is code 1 (neither 0 nor 2)", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
check("Ground truth: Code 1 indicates missing function", ((contains(out, "unauthenticated"))), strip(out));
([rc_auth_ok, out_auth_ok]=probe(process.execPath,"--auth",JSON.stringify(process.execPath)+' -e "process.exit(0)"'));
check("Ground truth: Authentication success stub is code 0 (authentication axis does not prevent success)", (isDeepStrictEqual(rc_auth_ok,0)), ("rc=" + pyStr(rc_auth_ok) + " " + pyStr(slice(strip(out_auth_ok), 0, 40))));
check("Ground truth: Authentication success and failure have different codes (0 to 1)", ((value:any)=>truth(value)?(isDeepStrictEqual(rc,1)):value)((isDeepStrictEqual(rc_auth_ok,0))), ("success rc=" + pyStr(rc_auth_ok) + " failure rc=" + pyStr(rc)));
(quiet=Array.from([[process.execPath], [process.execPath, "--auth", JSON.stringify(process.execPath)+' -e "process.exit(0)"'], [process.execPath, "--floor", "1.0"], [process.execPath, "--floor", "1.0", "--auth", JSON.stringify(process.execPath)+' -e "process.exit(0)"']]).filter((a: any) => truth((!isDeepStrictEqual(at(probe(...a), 1),"")))).map((a: any) => (a)));
(speaks=((value:any)=>truth(value)?(!isDeepStrictEqual(strip(at(probe("definitely-not-a-real-binary-xyz","--install","brew install example"), 1)),"")):value)((!isDeepStrictEqual(strip(out),""))));
check("actual measurement: stdout of success path net is exactly empty and states 1·2 say", ((value:any)=>truth(value)?speaks:value)(!truth(quiet)), ("noisy success paths " + pyStr(quiet) + " / states 1 and 2 speak " + pyStr(speaks)));
([rc0, o0]=probe(process.execPath));
([rc1, o1]=probe(process.execPath,"--auth",JSON.stringify(process.execPath)+' -e "process.exit(1)"'));
([rc2, o2]=probe("definitely-not-a-real-binary-xyz","--install","brew install example"));
check("Actual: Status marker matches code (0 no output · 1 is `[1] ` · 2 is `[2] `)", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?starts(o2, "[2] "):value)((isDeepStrictEqual(rc2,2))):value)(starts(o1, "[1] ")):value)((isDeepStrictEqual(rc1,1))):value)((isDeepStrictEqual([rc0, o0],[0, ""]))), (pyStr(rc0) + pyStr(slice(o0, 0, 6)) + " " + pyStr(rc1) + pyStr(slice(o1, 0, 6)) + " " + pyStr(rc2) + pyStr(slice(o2, 0, 6))));
(doc_states=Object.fromEntries(Array.from(table(skill, "## Three states, not two")).map((c: any) => ([at(c, 0), joinText(" ", slice(c, 1))]))));
(cross=[[rc0, "Fully available", "Proceed"], [rc1, "Partially available", "reduced path"], [rc2, "Blocked", "install guidance"]]);
(bad=Array.from(cross).filter(([c, w, a]: any) => truth(((value:any)=>truth(value)?value:((!contains((doc_states[pyStr(c)] ?? ""), a))))(((!contains((doc_states[pyStr(c)] ?? ""), w)))))).map(([c, w, a]: any) => ([c, w])));
check("Intersection: The row in the exit code table is attached to the code that probe.js actually emits.", ((value:any)=>truth(value)?(isDeepStrictEqual(length(doc_states),3)):value)(!truth(bad)), ("mismatches " + pyStr(bad) + " / table " + pyStr(sorted(doc_states))));
{const tmp=temporaryDirectory();try{(broken=join(tmp, "brokentool"));
{const f=fileHandle(broken,"w");f.write("#!"+process.execPath+"\n"+"console.error(\"dyld[1]: Library not loaded: @rpath/libx.dylib\");process.exitCode=127;");}
chmodSync(broken, 493);
([rc, out]=probe("brokentool","--install","brew reinstall brokentool",{path_extra:tmp}));
check("Actual measurement: If the binary exists but execution is killed, code 2 (not 0)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 60))));
check("ground truth: The diagnosis points to runtime dependence", ((contains(out, "runtime dependency"))));
(pt=join(tmp, "patchy"));
{const f=fileHandle(pt,"w");f.write("#!"+process.execPath+"\n"+"console.log(\"patchy 1.2.3\");");}
chmodSync(pt, 493);
([rc, _]=probe("patchy","--floor","1.2.4",{path_extra:tmp}));
check("Actual measurement: Patch level lower limit is applied (1.2.3 < 1.2.4)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc, _]=probe("patchy","--floor","1.2.3",{path_extra:tmp}));
check("Ground truth: Same patch level passes", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
(dy=join(tmp, "toola"));
{const f=fileHandle(dy,"w");f.write("#!"+process.execPath+"\n"+"console.error(\"dyld: Library not loaded: /usr/local/lib/libfoo.dylib\\n  Reason: Incompatible library version: toola requires version 10.0.0 or later, but libfoo.dylib provides version 9.0.0\");process.exitCode=134;");}
chmodSync(dy, 493);
([rc, out]=probe("toola","--install","brew reinstall toola",{path_extra:tmp}));
check("Ground truth: dyld incompatible regular phrase has code 2", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
(lg=join(tmp, "logtool"));
{const f=fileHandle(lg,"w");f.write("#!"+process.execPath+"\n"+"console.error(\"2024-01-15 ERROR: cannot load module libx\");process.exitCode=1;");}
chmodSync(lg, 493);
([rc, _]=probe("logtool",{path_extra:tmp}));
check("Ground truth: Timestamp error log does not act as a copy", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
(si=join(tmp, "silenttool"));
{const f=fileHandle(si,"w");f.write("#!"+process.execPath+"\n"+"process.exitCode=0;");}
chmodSync(si, 493);
([rc, _]=probe("silenttool",{path_extra:tmp}));
check("Ground truth: A tool with exit 0 and no output is available.", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
([rc, out]=probe("silenttool","--floor","1.0",{path_extra:tmp}));
check("Actual measurement: If you set a lower limit on the tool, it will not be able to read the version and will be blocked.", ((value:any)=>truth(value)?((contains(out, "cannot read silenttool version"))):value)((isDeepStrictEqual(rc,2))), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 50))));
(e1=join(tmp, "exit1tool"));
{const f=fileHandle(e1,"w");f.write("#!"+process.execPath+"\n"+"console.log(\"toolz 3.4.5\");process.exitCode=1;");}
chmodSync(e1, 493);
([rc, out]=probe("exit1tool",{path_extra:tmp}));
check("Ground truth: output version, but tools with exit 1 are blocked (known limitation)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
(dd=join(tmp, "dottydecoy"));
{const f=fileHandle(dd,"w");f.write("#!"+process.execPath+"\n"+"console.log(\"Python 3.9 wrapper for dottydecoy version 10.2.0\");");}
chmodSync(dd, 493);
([rc, out]=probe("dottydecoy","--floor","10.0.0",{path_extra:tmp}));
check("Actual measurement: Pick up the actual version, not the previous decoy token.", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 60))));
(java=join(tmp, "javaish"));
{const f=fileHandle(java,"w");f.write("#!"+process.execPath+"\n"+"if(process.argv[2]===\"-version\"){console.log(\"openjdk version 17.0.9\");}else{console.error(\"Unrecognized option: --version\");process.exitCode=1;}");}
chmodSync(java, 493);
([rc, out]=probe("javaish","--floor","11",{path_extra:tmp}));
check("Ground truth: tools that only accept `-version` also read the version (fallbacks are included)", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 60))));}finally{removeTree(tmp);}}
for (let [args, why] of [[["git", "--floor"], "--floor without a value"], [["git", "--auth"], "--auth without a value"], [["git", "--install"], "--install without a value"]]) {
(r=subprocessRun([process.execPath, PROBE, ...args],{capture_output:true,text:true,timeout:10}));
check(("Ground truth: " + pyStr(why) + " returns code 2 without hanging"), (isDeepStrictEqual(r.returncode,2)), ("rc=" + pyStr(r.returncode)));
}
([rc, out]=probe("git","--flooor","99.0.0"));
check("actual measurement: do not swallow unknown flags, code 2", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc, out]=probe("git","extra-arg"));
check("Actual measurement: If there are more than two arguments, code 2", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
{const tmp=temporaryDirectory();try{(d=stub(tmp, "verstub", "verstub 10.0.0"));
([rc, out]=probe("verstub","--floor","9.0.0",{path_extra:d}));
check("ground truth: 10.0.0 passes the lower bound 9.0.0 (failure if string comparison)", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc) + " " + pyStr(strip(out))));
([rc, out]=probe("verstub","--floor","10.1.0",{path_extra:d}));
check("ground truth: 10.0.0 falls on the lower bound of 10.1.0", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
([rc, out]=probe("verstub","--floor","10.0.0",{path_extra:d}));
check("Ground truth: identical versions pass the lower bound", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc)));
(d9=stub(tmp, "verstub9", "verstub9 9.0.0"));
([rc, out]=probe("verstub9","--floor","10.0.0",{path_extra:d9}));
check("ground truth: 9.0.0 falls on the lower limit of 10.0.0 (opposite direction of passage)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 50))));
(dm=stub(tmp, "minorstub", "minorstub 2.9.0"));
([rc, out]=probe("minorstub","--floor","2.10.0",{path_extra:dm}));
check("Actual: 2.9.0 falls on the lower bound of 2.10.0 (string comparison passes)", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 50))));
(dM=stub(tmp, "minorstub2", "minorstub2 2.10.0"));
([rc, out]=probe("minorstub2","--floor","2.9.0",{path_extra:dM}));
check("Ground truth: 2.10.0 passes the lower bound 2.9.0 (its counterpart)", (isDeepStrictEqual(rc,0)), ("rc=" + pyStr(rc) + " " + pyStr(slice(strip(out), 0, 50))));}finally{removeTree(tmp);}}
check("version: Document requires numerical comparison by field", says(rec, "Compare versions numerically, field by field."));
check("version: Specifies when string comparison fails", says(rec, "String comparison puts 10 before 9, which fails exactly once — at the release that matters most."));
check("version: Requires lower bounds to be placed only on measured incompatibilities", says(rec, "Record a floor only where a real incompatibility was observed, and record what was observed next to it."));
check("version: Revealing what a made-up lower limit prevents\nAt ", says(rec, "A floor invented for safety silently blocks working environments, and nobody can tell later whether it was measured or guessed."));
check("Bulk inspection is prohibited at startup", ((contains(skill, "not at startup"))));
check("viewpoint: Revealing the two costs of bulk inspection", says(skill, "Checking everything up front makes every session pay for tools that session will not touch, and the check goes stale the moment the environment changes."));
check("downsizing: not disclosing the downsizing means a quiet demotion", says(skill, "A reduced path that does not say it is reduced is a silent downgrade"));
check("Zoom Out: User Reveals That He Reads It All As Money", says(skill, "and the user reads the output as if the full tool ran."));
check("Reduction: Eliminate meaningless expressions like ‘restricted mode’", says(skill, "Say which capability is gone and what that means for the result — not \"running in limited mode\", which names nothing."));
(ph=rows(rec, "## Phrasing per state"));
check("Degradation: per-state wording table has three rows", (isDeepStrictEqual(length(ph),3)), (pyStr(length(ph)) + " rows"));
check("Collapse: state 0 states that silence is intent", says(rec, "State 0 printing nothing is deliberate."));
check("Reduction: When notified every time, status 1 is not read.", says(rec, "A probe that announces success on every call trains the reader to skip its output, and then state 1 goes unread too."));
(ph_t=Object.fromEntries(Array.from(table(rec, "## Phrasing per state")).map((c: any) => ([at(c, 0), joinText(" ", slice(c, 1))]))));
check("Expression: Status 0 line is 'do not say anything'", starts((ph_t["0"] ?? ""), "Nothing"), (ph_t["0"] ?? ""));
check("Expression: Status 1 line tells you what functionality is missing", ((contains((ph_t["1"] ?? ""), "Which capability is unavailable"))), (ph_t["1"] ?? ""));
check("Expression: Status line 2 requires exact installation command\nWrapping ", ((contains((ph_t["2"] ?? ""), "the exact install command"))), (ph_t["2"] ?? ""));
check("Reveals that it will be a second interface\nWrapping ", says(skill, "When it starts reformatting arguments, reordering flags, or re-implementing a subcommand, it has become a second interface to maintain"));
check("Reveals that it is against the next release", says(skill, "it will drift from the first one on the tool's next release."));
check("wrapping: Instructs to pass the argument as is.", says(skill, "Pass the user's arguments through."));
check("Instructs the tool not to substitute its own error message.", says(skill, "If the tool's own error message is the clearest thing available, show it rather than replacing it with a friendlier one that says less."));
(ch=rows(rec, "## The shape"));
check("Strength: probe-strength table has four rows", (isDeepStrictEqual(length(ch),4)), (pyStr(length(ch)) + " rows"));
check("Intensity: The lower you go, the stronger and slower it becomes.", ((value:any)=>truth(value)?((contains(rec, "strictly slower"))):value)(((contains(rec, "strictly stronger")))));
check("Strength: Instructs to choose the weakest validation", ((contains(rec, "weakest check that would actually catch"))));
check("Strength: Expensive Probe Reveals Eventually Removal", ((value:any)=>truth(value)?value:((contains(rec, "gets removed by whoever is debugging"))))(((contains(rec, "gets removed by whoever is\ndebugging")))));
(sh_t=table(rec, "## The shape"));
check("Strength: The first line is the PATH resolution and the last line is the authentication call (order is strength)", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(at(at(sh_t, 3), 2), "quota"))):value)(((contains(at(at(sh_t, 3), 0), "authenticated call")))):value)(((contains(at(at(sh_t, 0), 1), "installed")))):value)(((contains(at(at(sh_t, 0), 0), "PATH")))):value)((isDeepStrictEqual(length(sh_t),4))), (pyStr(Array.from(sh_t).map((r: any) => (at(r, 0))))));
check("Certification: Reveals that certification and installation are in different states", ((contains(rec, "Authentication is not installation"))));
check("gh Example: State 1 states 'binary exists, no authentication'", says(rec, "binary resolves, `gh auth status` returns non-zero"));
check("gh example: Explain the reason for setting non-authentication to 1 instead of 2", says(rec, "Signed-out is state 1, not 2, because a caller can still run on the reduced path"));
(gh_t=Object.fromEntries(Array.from(table(rec, "## `gh` — the worked example")).map((c: any) => ([at(c, 0), at(c, -(1))]))));
check("gh Example: Ready/Signed out/Absent are 0/1/2 respectively\nCross ", (isDeepStrictEqual([(gh_t["Ready"] ?? null), (gh_t["Signed out"] ?? null), (gh_t["Absent"] ?? null)],["0", "1", "2"])), (pyStr(gh_t)));
(cmds=install_block(rec));
(hook_src=read_or_empty(HOOK));
(drift=Array.from(cmds).filter((c: any) => truth(((!contains(hook_src, c))))).map((c: any) => (c)));
check("The four canonical installation commands match the instructions in validate_pr_label.js", ((value:any)=>truth(value)?((value:any)=>truth(value)?truth(hook_src):value)(!truth(drift)):value)((isDeepStrictEqual(length(cmds),4))), (pyStr(length(cmds)) + " lines / missing from hook " + pyStr(drift)));
check("Certification: Reveals the consequences of misclassification (reinstalling something that is not the problem)", ((value:any)=>truth(value)?value:((contains(rec, "never the problem"))))(((contains(rec, "never\nthe problem")))));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("boundary: Return target population is not empty", (compare(length(named),2,">=")), (pyStr(sorted(named))));
check("Boundary: every named return target exists", !truth(missing), ("missing " + pyStr(missing)));
check("Language: description has Korean trigger", (compare(length(findall("[가-힣]+", fm)),5,">=")));
check("Language: English also has trigger", ((value:any)=>truth(value)?((contains(fm, "CLI"))):value)(((contains(fm, "ensure")))));
check("L0: description declares these three states", ((contains(fm, "three availability states"))));
check("L0: description instead declares not to install", ((contains(fm, "instead of installing anything"))));
check("Installation: SKILL.md quotes script", ((value:any)=>truth(value)?((contains(skill, "`scripts/rules.json`"))):value)(((contains(skill, "`scripts/install.js`")))));
check("Installation: The text nails the root decision rule.", ((contains(skill, "found by marker, not by path arithmetic"))));
check("Installation: Reveals the result of path arithmetic (deletes the installer)", ((contains(skill, "deletes the installed skills while reporting success"))));
check("Installation: The text nails the self-exclusion standard", ((contains(skill, "excludes itself by skill directory, not by plugin name"))));
check("Installation: Token dies on link", ((contains(skill, "does not survive a symlink"))));
check("Installation: Checks runtime references and scripts as well as top-level body", ((contains(skill, "Classification covers the runtime tree, not only `SKILL.md`"))));
check("Installation: The global skill of the same name is said not to cover either side.\nInstall ", ((value:any)=>truth(value)?value:((contains(skill, "If two plugins provide the same skill name, neither may overwrite the other"))))(((contains(skill, "If two plugins provide the same skill name, neither\nmay overwrite the other")))));
check("Replace the link after proving ownership with a lock and independence symbol.\nInstall ", ((value:any)=>truth(value)?value:((contains(skill, "matches the lock record to the link target or the generated-file header"))))(((contains(skill, "matches the lock record to the link target or the\ngenerated-file header")))));
check("Preserve user-owned links", ((contains(skill, "A user-owned link is preserved"))));
check("Installation: Ensure that quoted strings are not subject to replacement.\nInstall ", ((contains(skill, "Substitution is for notation, never for a quoted literal"))));
check("Reveal the consequences of citation substitution (document-validator mismatch)", ((contains(skill, "keeps enforcing the original"))));
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "This skill probes and hands back."}), "gitrules": fmFormat({n: "gitrules", b: "**Never include** `Generated with Claude Code` in a message.\nRun `${CLAUDE_PLUGIN_ROOT}/skills/gitrules/scripts/check.py` first."}), "plain": fmFormat({n: "plain", b: "Claude Code is the host. See CLAUDE.md."}), "linky": fmFormat({n: "linky", b: "Nothing host-specific lives here."}), "agenty": fmFormat({n: "agenty", b: "Delegate with subagent_type=explore."})}));
([rc, out]=install(script, codex));
(dest=join(codex, "skills"));
(got=sorted(Array.from(readdirSync(dest)).filter((n: any) => truth(!truth(starts(n, ".")))).map((n: any) => (n))));
(gitr=read_or_empty(join(dest, "gitrules", "SKILL.md")));
(plainr=read_or_empty(join(dest, "plain", "SKILL.md")));
check("Ground truth: Marker lookup finds marketplace roots even in deep deployments", ((value:any)=>truth(value)?((contains(out, "link"))):value)(((contains(out, root)))), slice(strip(out), 0, 70));
check("Ground truth: does not install itself", (isDeepStrictEqual(got,["gitrules", "linky", "plain"])), (pyStr(got)));
check("Actual measurement: Report self-exclusion with reasons", ((contains(out, "the skill that owns this installer"))), slice(strip(out), -(70)));
check("Fact: Skills with tokens are not links, but substitution copies.", ((value:any)=>truth(value)?truth(gitr):value)(!truth(islink(join(dest, "gitrules")))));
check("Ground truth: Tokens are replaced with absolute paths", ((value:any)=>truth(value)?((contains(gitr, join(root, "staging", "jstack-dev")))):value)(((!contains(gitr, "${CLAUDE_PLUGIN_ROOT}")))), slice(strip(gitr), -(70)));
check("Ground truth: quoted prohibited strings are not replaced", ((contains(gitr, "Generated with Claude Code"))), slice(strip(gitr), -(70)));
check("Actual measurement: Notations outside quotations are replaced", ((value:any)=>truth(value)?((contains(plainr, "AGENTS.md"))):value)(((contains(plainr, "Codex is the host")))), slice(strip(plainr), -(60)));
check("Actual measurement: Skills with no replacement are symbolic links", islink(join(dest, "linky")));
check("Actual measurement: If there is a blocked skill, the code is 1 (neither 0 nor 2)", (isDeepStrictEqual(rc,1)), ("rc=" + pyStr(rc)));
check("Ground truth: Report blocked reason with name", ((value:any)=>truth(value)?((contains(out, "subagent selection differs"))):value)(((contains(out, "agenty")))));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_root, script, codex]=marketplace(tmp,{"agent-bridge": fmFormat({n: "agent-bridge", b: "Owns the installer."}), "bridge": fmFormat({n: "bridge", b: "A neighbour that happens to be named so."})},{owner:"agent-bridge"}));
([rc, out]=install(script, codex));
(got=sorted(Array.from(readdirSync(join(codex, "skills"))).filter((n: any) => truth(!truth(starts(n, ".")))).map((n: any) => (n))));
check("Actual measurement: Even if the name of the skill holding the script is different, it excludes itself.", (isDeepStrictEqual(got,["bridge"])), (pyStr(got)));
check("Ground truth: Then the neighbor named bridge is installed.", ((value:any)=>truth(value)?(isDeepStrictEqual(rc,0)):value)(lexists(join(codex, "skills", "bridge"))), ("rc=" + pyStr(rc)));
check("Intersection: Self-exclusion — The standard (directory) declared in the text is the same as the actual measurement", ((value:any)=>truth(value)?(isDeepStrictEqual(got,["bridge"])):value)(says(skill, "The installer excludes itself by skill directory, not by plugin name.")), (pyStr(got)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Only this skill exists here."})}));
(dest=join(codex, "skills"));
mkdirSync(join(dest, "oldskill"),{recursive:true});
{const f=fileHandle(join(dest, "oldskill", "SKILL.md"),"w");f.write("x");}
(lock_path=join(dest, ".jstack-bridge.json"));
{const f=fileHandle(lock_path,"w");f.write(JSON.stringify({"jstack-dev:oldskill": {"mode": "link"}}));}
([rc, out]=install(script, codex));
check("Actual measurement: If the scan is empty and the lock file is full, it is not retrieved and code 2 is returned.", (isDeepStrictEqual(rc,2)), ("rc=" + pyStr(rc)));
check("Actual measurement: The installation version survives then", isdir(join(dest, "oldskill")));
check("Actual measurement: Then the lock file is preserved.", (isDeepStrictEqual(JSON.parse(readFileSync(lock_path,"utf8")),{"jstack-dev:oldskill": {"mode": "link"}})));
(doc_refuses=says(skill, "refuses to reclaim anything when an empty scan meets a non-empty lockfile."));
(live_refuses=((value:any)=>truth(value)?isdir(join(dest, "oldskill")):value)((isDeepStrictEqual(rc,2))));
check("Intersection: Retrieval Guard — Both the text claim and the ground truth behavior are 'not retrieval'", ((value:any)=>truth(value)?live_refuses:value)(doc_refuses), ("document " + pyStr(doc_refuses) + " / observed " + pyStr(live_refuses)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "x"})},{with_marker:false}));
([rc, out]=install(script, codex));
check("Actual measurement: If there is no marker, code 2 (does not take wrong route)", ((value:any)=>truth(value)?((contains(out, "Marketplace root not found"))):value)((isDeepStrictEqual(rc,2))), ("rc=" + pyStr(rc)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "x"}), "linky": fmFormat({n: "linky", b: "Nothing host-specific lives here."})}));
([rc, out]=install(script, join(tmp, "no-such-home")));
check("Actual measurement: Code 2 if Codex skills directory does not exist", ((value:any)=>truth(value)?((contains(out, "Codex skills directory does not exist"))):value)((isDeepStrictEqual(rc,2))), ("rc=" + pyStr(rc)));
([rc, out]=install(script, codex, "--dry-run"));
(left=sorted(Array.from(readdirSync(join(codex, "skills"))).map((n: any) => (n))));
check("actual measurement: dry-run does not install anything", ((value:any)=>truth(value)?((contains(out, "dry-run"))):value)((isDeepStrictEqual(left,[]))), (pyStr(left)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{(planted={"bridge": fmFormat({n: "bridge", b: "Owner of the installer."})});
for (let [i, pat] of enumerate(EXPECT_BLOCKERS)) {
(planted[("blk" + pyStr(i))]=fmFormat({n: ("blk" + pyStr(i)), b: ("Blocked sample " + pyStr(((value:any)=>truth(value)?value:"NO-SAMPLE")(literal_of(pat))) + " end.")}));
}
for (let [i, [frm, _to]] of enumerate(EXPECT_SUBS)) {
(planted[("sub" + pyStr(i))]=fmFormat({n: ("sub" + pyStr(i)), b: ("Notation sample " + pyStr(((value:any)=>truth(value)?value:"NO-SAMPLE")(literal_of(frm))) + " end.")}));
}
([_r, script, codex]=marketplace(tmp,planted));
([rules_rc, rules_out]=install(script, codex));
(rdest=join(codex, "skills"));
check("Actual measurement: If there is a skill with a blocking rule, it is code 1 (rule execution fixture)", (isDeepStrictEqual(rules_rc,1)), ("rc=" + pyStr(rules_rc)));
for (let [i, pat] of enumerate(EXPECT_BLOCKERS)) {
(lit=literal_of(pat));
check(("Rule execution: skill containing blocker pattern " + pyStr(pat) + " is blocked"), ((value:any)=>truth(value)?((value:any)=>truth(value)?!truth(lexists(join(rdest, ("blk" + pyStr(i))))):value)(((contains(rules_out, ("jstack-dev:blk" + pyStr(i)))))):value)(((lit !== null))), ("sample " + pyStr(lit)));
}
for (let [i, [frm, to]] of enumerate(EXPECT_SUBS)) {
(lit=literal_of(frm));
(body=read_or_empty(join(rdest, ("sub" + pyStr(i)), "SKILL.md")));
(after=at(split(body, "-->", 1), -(1)));
check(("Rule execution: substitution " + pyStr(frm) + " becomes " + pyStr(to) + " in output"), ((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(after, lit))):value)(((contains(after, to)))):value)(((lit !== null))), ("sample " + pyStr(lit) + " / output " + pyStr(slice(strip(after), 0, 50))));
}}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_r, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "linky": fmFormat({n: "linky", b: "Nothing host-specific lives here."})}));
(ddir=join(codex, "skills", "linky"));
mkdirSync(ddir,{recursive:true});
{const f=fileHandle(join(ddir, "SKILL.md"),"w");f.write("User-owned content.");}
([keep_rc, keep_out]=install(script, codex));
check("Actual measurement: The real directory of the same name that is not in the lock is preserved without covering it.", ((value:any)=>truth(value)?!truth(islink(ddir)):value)((isDeepStrictEqual(read_or_empty(join(ddir, "SKILL.md")),"User-owned content."))), ("rc=" + pyStr(keep_rc)));
check("Actual measurement: Then report what was skipped with name and reason.", ((value:any)=>truth(value)?((contains(keep_out, "cannot prove bridge ownership"))):value)(((contains(keep_out, "jstack-dev:linky")))), slice(strip(keep_out), -(70)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_r, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "linky": fmFormat({n: "linky", b: "Marketplace version."})}));
(foreign=join(tmp, "user-owned-link-target"));
mkdirSync(foreign,{recursive:true});
{const f=fileHandle(join(foreign, "SKILL.md"),"w");f.write("user-owned");}
(dst=join(codex, "skills", "linky"));
symlinkSync(foreign, dst);
([user_rc, user_out]=install(script, codex));
check("Ground truth: Do not replace user symbolic links that are not in lock.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(read_or_empty(join(dst, "SKILL.md")),"user-owned")):value)((isDeepStrictEqual(realpathSync(dst),realpathSync(foreign)))):value)(islink(dst)):value)((isDeepStrictEqual(user_rc,0))), ("rc=" + pyStr(user_rc) + " target=" + pyStr(realpathSync(dst))));
check("Ground truth: Report reasons for preserving user links", ((value:any)=>truth(value)?((contains(user_out, "cannot prove bridge ownership"))):value)(((contains(user_out, "jstack-dev:linky")))));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "dep-rewrite": fmFormat({n: "dep-rewrite", b: "Read references/guide.md."}), "dep-block": fmFormat({n: "dep-block", b: "Read references/guide.md."})}));
(base=join(root, "staging", "jstack-dev", "skills"));
for (let [name, body] of [["dep-rewrite", "Follow CLAUDE.md."], ["dep-block", "Use subagent_type=explore."]]) {
(refdir=join(base, name, "references"));
mkdirSync(refdir,{recursive:true});
{const f=fileHandle(join(refdir, "guide.md"),"w");f.write(String(body));}
}
([dep_rc, dep_out]=install(script, codex));
(dep_dst=join(codex, "skills", "dep-rewrite"));
(guide=read_or_empty(join(dep_dst, "references", "guide.md")));
check("Ground truth: Copy instead of link even if only the reference has a substitution token", ((value:any)=>truth(value)?(isDeepStrictEqual(guide,"Follow AGENTS.md.")):value)(!truth(islink(dep_dst))));
check("Actual measurement: The Claude-only meaning of the reference also pre-blocks the entire skill.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?!truth(lexists(join(codex, "skills", "dep-block"))):value)(((contains(dep_out, "references/guide.md")))):value)(((contains(dep_out, "jstack-dev:dep-block")))):value)((isDeepStrictEqual(dep_rc,1))), ("rc=" + pyStr(dep_rc)));
(rec=(lock_of(codex)["jstack-dev:dep-rewrite"] ?? {}));
check("Ground truth: Write the tree hash containing the reference to the lock.", truth(/^[0-9a-f]{64}$/.test(rec["tree_sha256"] ?? "")));
{const f=fileHandle(join(base, "dep-rewrite", "references", "guide.md"),"a");f.write("\nMore guidance.\n");}
([dep2_rc, dep2_out]=install(script, codex));
check("Actual measurement: Reference changes are captured as upstream updates even if the top-level text remains the same.", ((value:any)=>truth(value)?(isDeepStrictEqual(counted(dep2_out, "updated"),1)):value)((isDeepStrictEqual(dep2_rc,1))), ("rc=" + pyStr(dep2_rc) + " updated=" + pyStr(counted(dep2_out, "updated"))));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "runner": fmFormat({n: "runner", b: "node ${CLAUDE_PLUGIN_ROOT}/skills/runner/scripts/tool.js\nnode \"${CLAUDE_PLUGIN_ROOT}/skills/runner/scripts/quoted.js\""})}));
(spaced_root=join(tmp, "market place"));
renameSync(root, spaced_root);
(script=replace(script, root, spaced_root));
(tool_dir=join(spaced_root, "staging", "jstack-dev", "skills", "runner", "scripts"));
mkdirSync(tool_dir,{recursive:true});
{const f=fileHandle(join(tool_dir, "tool.js"),"w");f.write("console.log('SPACE_OK');\n");}
{const f=fileHandle(join(tool_dir, "quoted.js"),"w");f.write("console.log('QUOTED_OK');\n");}
([space_rc, _space_out]=install(script, codex));
(installed=read_or_empty(join(codex, "skills", "runner", "SKILL.md")));
(commands=Array.from(lines(installed)).filter((line: any) => truth(starts(line, ["node "]))).map((line: any) => (line)));
(py_run=(truth((compare(length(commands),0,">"))) ? subprocessRun([process.execPath,...shellWords(at(commands,0)).slice(1)],{capture_output:true,text:true}) : null));
(sh_run=(truth((compare(length(commands),1,">"))) ? subprocessRun([process.execPath,...shellWords(at(commands,1)).slice(1)],{capture_output:true,text:true}) : null));
check("Actual measurement: unquoted token substitution command with empty root is actually executed", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(strip(py_run.stdout),"SPACE_OK")):value)((isDeepStrictEqual(py_run.returncode,0))):value)(((py_run !== null))):value)((isDeepStrictEqual(space_rc,0))), ("rc=" + pyStr((truth(((py_run !== null))) ? py_run.returncode : "missing"))));
check("Actual measurement: Existing quote token replacement commands in blank roots are also actually executed.", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(strip(sh_run.stdout),"QUOTED_OK")):value)((isDeepStrictEqual(sh_run.returncode,0))):value)(((sh_run !== null))), ("rc=" + pyStr((truth(((sh_run !== null))) ? sh_run.returncode : "missing"))));
check("Ground truth: Blank root installation has no outstanding plugin root tokens", ((!contains(installed, "${CLAUDE_PLUGIN_ROOT}"))));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "domain-api": fmFormat({n: "domain-api", b: "samples = dataset.set_task(MortalityPrediction())"}), "declared-tool": "---\nname: declared-tool\nallowed-tools:\n  - AskUserQuestion\n---\n\nThe body contains no harness-specific instruction.\n"}));
([domain_rc, domain_out]=install(script, codex));
check("Voice comparison: Lowercase set_task domain API is not blocked with the Claude Task tool.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(lower(domain_out), "action required"))):value)(lexists(join(codex, "skills", "domain-api"))):value)((isDeepStrictEqual(domain_rc,0))), ("rc=" + pyStr(domain_rc)));
check("Voice contrast: Do not block frontmatter-allowed tool declarations with execution instructions.", ((value:any)=>truth(value)?lexists(join(codex, "skills", "declared-tool")):value)((isDeepStrictEqual(domain_rc,0))), ("rc=" + pyStr(domain_rc)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."})}));
(marker_path=join(root, ".claude-plugin", "marketplace.json"));
{const f=fileHandle(marker_path,"r");(marker=JSON.parse(f.read()));}
(marker["plugins"]=[{"name": "a", "source": "./plugins/a"}, {"name": "b", "source": "./plugins/b"}]);
for (let plug of ["a", "b"]) {
(d=join(root, "plugins", plug, "skills", "shared"));
mkdirSync(d,{recursive:true});
{const f=fileHandle(join(d, "SKILL.md"),"w");f.write(fmFormat({n: "shared", b: ("Owned by " + pyStr(plug) + ".")}));}
}
{const f=fileHandle(marker_path,"w");f.write(JSON.stringify(marker));}
([collision_rc, collision_out]=install(script, codex));
(shared=join(codex, "skills", "shared"));
check("Actual measurement: The skills of the two plugins with the same name are blocked in advance and neither is installed.", ((value:any)=>truth(value)?((value:any)=>truth(value)?!truth((Object.keys(lock_of(codex)).map((k: any) => (ends(k, ":shared")))).some((value:any)=>truth(value))):value)(!truth(lexists(shared))):value)((isDeepStrictEqual(collision_rc,1))), ("rc=" + pyStr(collision_rc) + " lock=" + pyStr(sorted(lock_of(codex)))));
check("Ground truth: Report two sources of homonymous collisions and the global name.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(collision_out, "global skill-name collision"))):value)(((contains(collision_out, "b:shared")))):value)(((contains(collision_out, "a:shared")))));
(bdir=join(root, "plugins", "b", "skills", "shared"));
symlinkSync(bdir, shared);
{const f=fileHandle(join(codex, "skills", ".jstack-bridge.json"),"w");f.write(JSON.stringify({"a:shared": {"source": "plugins/a/skills/shared/SKILL.md", "mode": "link"}, "b:shared": {"source": "plugins/b/skills/shared/SKILL.md", "mode": "link"}}));}
removeTree(join(root, "plugins", "a"));
([recover_rc, recover_out]=install(script, codex));
check("Ground truth: Retrieving a missing eponymous source does not clear paths for other living owners", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(counted(recover_out, "removed"),0)):value)((isDeepStrictEqual(new Set(Object.keys(lock_of(codex))),new Set(["b:shared"])))):value)((isDeepStrictEqual(realpathSync(shared),realpathSync(bdir)))):value)(islink(shared)):value)((isDeepStrictEqual(recover_rc,0))), ("rc=" + pyStr(recover_rc) + " lock=" + pyStr(sorted(lock_of(codex)))));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([_r, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "dual": fmFormat({n: "dual", b: "Delegate with subagent_type=explore."})},{extra:{"dual": {"SKILL.codex.md": "# dual — Codex edition\n\nCodex-specific body.\n"}}}));
([ov_rc, ov_out]=install(script, codex));
(ov=read_or_empty(join(codex, "skills", "dual", "SKILL.md")));
check("Actual measurement: If there is a dedicated copy, it is installed as override, not blocked.", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(ov_rc,0)):value)(((!contains(ov, "subagent_type")))):value)(((contains(ov, "Codex-specific body.")))), ("rc=" + pyStr(ov_rc) + " " + pyStr(slice(strip(ov), -(50)))));
check("Actual measurement: override also comes with a source header", ((value:any)=>truth(value)?((contains(ov, "source-sha256:"))):value)(((contains(ov, "generated by the bridge skill from")))));
check("Actual: Do not leave SKILL.codex.md in the copy (the two texts do not live together)", !truth(existsSync(join(codex, "skills", "dual", "SKILL.codex.md"))));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "gitrules": fmFormat({n: "gitrules", b: "Run `${CLAUDE_PLUGIN_ROOT}/skills/gitrules/scripts/check.py` first."}), "linky": fmFormat({n: "linky", b: "Nothing host-specific lives here."})}));
(gsrc=join(root, "staging", "jstack-dev", "skills", "gitrules", "SKILL.md"));
(dst_g=join(codex, "skills", "gitrules", "SKILL.md"));
(digest1=createHash("sha256").update(readFileSync(gsrc)).digest("hex"));
([r1c, _r1o]=install(script, codex));
(lock1=lock_of(codex));
(rec1=(lock1["jstack-dev:gitrules"] ?? {}));
(head1=read_or_empty(dst_g));
check("Actual measurement: The lock file records the original sha256 as is.", (isDeepStrictEqual((rec1["source_sha256"] ?? null),digest1)), (pyStr((rec1["source_sha256"] ?? null))));
check("Ground truth: lock items have commit and install times", ((value:any)=>truth(value)?truth(match("\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d", (rec1["installed_at"] ?? ""))):value)(truth((rec1["commit"] ?? null))), (pyStr((rec1["commit"] ?? null)) + " " + pyStr((rec1["installed_at"] ?? null))));
check("Actual measurement: The source and original sha256 are written in the head of the product.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(head1, "Do not edit this file directly"))):value)(((contains(head1, "generated by the bridge skill from")))):value)(((contains(head1, ("source-sha256: " + pyStr(digest1)))))), (truth(head1) ? slice(at(lines(head1), 0), 0, 60) : ""));
([r2c, r2o]=install(script, codex));
(strip_time=(lk:any)=>Object.fromEntries(Array.from(Object.entries(lk)).map(([k, v]: any) => ([k, Object.fromEntries(Array.from(Object.entries(v)).filter(([a, b]: any) => truth((!isDeepStrictEqual(a,"installed_at")))).map(([a, b]: any) => ([a, b])))]))));
check("actual measurement: Re-executing the original without changes has a count of 0 and an update of 0.", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(counted(r2o, "updated"),0)):value)((isDeepStrictEqual(counted(r2o, "removed"),0))):value)((isDeepStrictEqual(r2c,0))), ("rc=" + pyStr(r2c) + " removed=" + pyStr(counted(r2o, "removed")) + " updated=" + pyStr(counted(r2o, "updated"))));
check("Actual measurement: The contents of the lock file are the same (except for the installation time).", ((value:any)=>truth(value)?truth(lock1):value)((isDeepStrictEqual(strip_time(lock_of(codex)),strip_time(lock1)))));
{const f=fileHandle(gsrc,"a");f.write("One more line.\n");}
(digest2=createHash("sha256").update(readFileSync(gsrc)).digest("hex"));
([r3c, r3o]=install(script, codex));
(rec3=(lock_of(codex)["jstack-dev:gitrules"] ?? {}));
(head3=read_or_empty(dst_g));
check("Actual measurement: If the original is changed, one case is reported as an upstream change.", ((value:any)=>truth(value)?(isDeepStrictEqual(r3c,0)):value)((isDeepStrictEqual(counted(r3o, "updated"),1))), ("updated=" + pyStr(counted(r3o, "updated"))));
check("Actual measurement: Then sha of the lock is changed to a new value.", ((value:any)=>truth(value)?(isDeepStrictEqual((rec3["source_sha256"] ?? null),digest2)):value)((!isDeepStrictEqual(digest2,digest1))));
check("Actual measurement: Then sha in the product header is also a new value.", ((value:any)=>truth(value)?((contains(head3, "One more line."))):value)(((contains(head3, ("source-sha256: " + pyStr(digest2)))))));
([r4c, r4o]=install(script, codex, "--only", "jstack-dev"));
(left=sorted(Array.from(readdirSync(join(codex, "skills"))).filter((n: any) => truth(!truth(starts(n, ".")))).map((n: any) => (n))));
check("Actual measurement: Even if you run only the plugin with --only, the count is 0 and an installed copy remains.", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(left,["gitrules", "linky"])):value)((isDeepStrictEqual(counted(r4o, "removed"),0))):value)((isDeepStrictEqual(r4c,0))), ("rc=" + pyStr(r4c) + " removed=" + pyStr(counted(r4o, "removed")) + " " + pyStr(left)));}finally{removeTree(tmp);}}
{const tmp=temporaryDirectory();try{([root, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."})}));
(marker_path=join(root, ".claude-plugin", "marketplace.json"));
{const f=fileHandle(marker_path,"r");(marker=JSON.parse(f.read()));}
(marker["plugins"]=[{"name": "a", "source": "./plugins/a"}, {"name": "b", "source": "./plugins/b"}]);
for (let [plug, body] of [["a", "A skill."], ["b", "B skill."]]) {
(skill_dir=join(root, "plugins", plug, "skills", plug));
mkdirSync(skill_dir,{recursive:true});
{const f=fileHandle(join(skill_dir, "SKILL.md"),"w");f.write(fmFormat({n: plug, b: body}));}
}
{const f=fileHandle(marker_path,"w");f.write(JSON.stringify(marker));}
([all_rc, _all_out]=install(script, codex));
(b_dst=join(codex, "skills", "b"));
(b_record=(lock_of(codex)["b:b"] ?? {}));
check("Ground truth: synthetic a,b full installation records two plugins", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(new Set(Object.keys(lock_of(codex))),new Set(["a:a", "b:b"]))):value)(lexists(b_dst)):value)(lexists(join(codex, "skills", "a"))):value)((isDeepStrictEqual(all_rc,0))), ("rc=" + pyStr(all_rc) + " lock=" + pyStr(sorted(lock_of(codex)))));
([only_rc, only_out]=install(script, codex, "--only", "a"));
check("Actual measurement: --only a preserves the installation path and lock of unselected b", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(counted(only_out, "removed"),0)):value)((isDeepStrictEqual((lock_of(codex)["b:b"] ?? null),b_record))):value)(lexists(b_dst)):value)((isDeepStrictEqual(only_rc,0))), ("rc=" + pyStr(only_rc) + " removed=" + pyStr(counted(only_out, "removed")) + " lock=" + pyStr(sorted(lock_of(codex)))));
removeTree(join(root, "plugins", "a"));
([absent_rc, absent_out]=install(script, codex, "--only", "a"));
check("Real measurement: When the selected source a disappears, only a is retrieved and b is preserved.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(counted(absent_out, "removed"),1)):value)((isDeepStrictEqual(new Set(Object.keys(lock_of(codex))),new Set(["b:b"])))):value)(lexists(b_dst)):value)(!truth(lexists(join(codex, "skills", "a")))):value)((isDeepStrictEqual(absent_rc,0))), ("rc=" + pyStr(absent_rc) + " removed=" + pyStr(counted(absent_out, "removed")) + " lock=" + pyStr(sorted(lock_of(codex)))));
(blocked_dir=join(root, "plugins", "a", "skills", "a"));
mkdirSync(blocked_dir,{recursive:true});
{const f=fileHandle(join(blocked_dir, "SKILL.md"),"w");f.write(fmFormat({n: "a", b: "A skill restored before blocking."}));}
([reinstall_rc, _reinstall_out]=install(script, codex, "--only", "a"));
{const f=fileHandle(join(blocked_dir, "SKILL.md"),"w");f.write(fmFormat({n: "a", b: "Delegate with subagent_type=explore."}));}
([blocked_rc, blocked_out]=install(script, codex, "--only", "a"));
check("Actual measurement: Even if selected a is blocked, the path and lock of unselected b are preserved.", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(counted(blocked_out, "removed"),1)):value)(((contains(blocked_out, "a:a")))):value)((isDeepStrictEqual(lock_of(codex),{"b:b": b_record}))):value)(lexists(b_dst)):value)(!truth(lexists(join(codex, "skills", "a")))):value)((isDeepStrictEqual(blocked_rc,1))):value)((isDeepStrictEqual(reinstall_rc,0))), ("reinstall rc=" + pyStr(reinstall_rc) + " blocked rc=" + pyStr(blocked_rc) + " removed=" + pyStr(counted(blocked_out, "removed")) + " lock=" + pyStr(sorted(lock_of(codex)))));}finally{removeTree(tmp);}}
(claim=search("walks upward for `([^`]+)`", joinText(" ", split(skill))));
{const tmp=temporaryDirectory();try{([_r, script, codex]=marketplace(tmp,{"bridge": fmFormat({n: "bridge", b: "Owner of the installer."}), "linky": fmFormat({n: "linky", b: "Nothing host-specific lives here."})},{marker_rel:(truth(claim) ? group(claim, 1) : "no-such-marker.json")}));
([mk_rc, mk_out]=install(script, codex));
check("Intersection: install.js takes root at the marker position claimed in the text", ((value:any)=>truth(value)?((value:any)=>truth(value)?lexists(join(codex, "skills", "linky")):value)((isDeepStrictEqual(mk_rc,0))):value)(((claim !== null))), ("claim " + pyStr((truth(claim) ? group(claim, 1) : null)) + " rc=" + pyStr(mk_rc) + " " + pyStr(slice(strip(mk_out), 0, 40))));}finally{removeTree(tmp);}}
{const fixtureRoot=temporaryDirectory();try{
 const cases=[
  ['repeat','CLAUDE.md and CLAUDE.md','AGENTS.md and AGENTS.md'],
  ['literal','Generated with Claude Code. Claude Code is the host.','Generated with Claude Code. Codex is the host.'],
  ['ordered','~/.claude/settings.local.json then ~/.claude/settings.json','~/.codex/config.toml then ~/.codex/config.toml']
 ];
 const bodies=Object.fromEntries(cases.map(([name,body])=>[name,fmFormat({n:name,b:body})]));
 const [,entry,home]=marketplace(fixtureRoot,{bridge:fmFormat({n:'bridge',b:'Installer owner.'}),...bodies});
 const [status,output]=install(entry,home);
 for(const [name,,expected] of cases){const installed=read_or_empty(join(home,'skills',name,'SKILL.md'));check('Rewrite boundary: '+name+' preserves the complete expected body',status===0&&installed.includes(expected),`exit=${status} ${installed} ${output.slice(0,80)}`);}
}finally{removeTree(fixtureRoot);}}
(rules_raw=read_or_empty(RULES_JSON));
try {(rules=JSON.parse(rules_raw));}catch(error){(rules={});}
(subs=(rules["substitutions"] ?? []));
(blockers=(rules["blockers"] ?? []));
check("Rule: There is a guard in the rule to remove unquoted strings", ((contains(rules_raw, "(?<!Generated with )Claude Code"))));
check("rule: The reason for the guard is written in the rules file.", ((value:any)=>truth(value)?((contains(rules_raw, "global Claude Code replacement"))):value)(((contains(rules_raw, "quote literal forbidden strings")))));
check("Rules: there are exactly 13 substitution rules", (isDeepStrictEqual(length(subs),13)), (pyStr(length(subs)) + " rules"));
check("Rules: there are exactly six blocker rules", (isDeepStrictEqual(length(blockers),6)), (pyStr(length(blockers)) + " rules"));
check("Rule: The list of blocking patterns is the same as the canonical version of the suite.", (isDeepStrictEqual(Array.from(blockers).map((b: any) => ((b["pattern"] ?? null))),EXPECT_BLOCKERS)), (pyStr(Array.from(blockers).map((b: any) => ((b["pattern"] ?? null))))));
check("Rule: The substitution (from, to) list is the same as the original in the suite.", (isDeepStrictEqual(Array.from(subs).map((x: any) => ([(x["from"] ?? null), (x["to"] ?? null)])),EXPECT_SUBS)), (pyStr(Array.from(subs).map((x: any) => ((x["from"] ?? null))))));
check("Rule: All substitution patterns are compiled", ((value:any)=>truth(value)?truth(subs):value)((Array.from(subs).map((s: any) => (_compiles((s["from"] ?? ""))))).every((value:any)=>truth(value))));
check("Rule: Every blocking rule has a reason", ((value:any)=>truth(value)?truth(blockers):value)((Array.from(blockers).map((b: any) => ((b["reason"] ?? null)))).every((value:any)=>truth(value))));
(built_native=join(ROOT, "SKILL.codex.md"));
(source_native=join(PACKAGE_ROOT, "hosts", "codex", "skills", "bridge", "SKILL.md"));
(native=read_or_empty((truth(isfile(built_native)) ? built_native : source_native)));
check("native: entry retains point-of-use capability states", ((value:any)=>truth(value)?((contains(native, "scripts/probe.js"))):value)(((contains(native, "Exit 0 means fully available")))));
check("native: delivery names the shared build path and host boundary", ((value:any)=>truth(value)?((contains(native, "Claude commands"))):value)(((contains(native, "dist/packaging/build.js")))));
(exported=subprocessRun([({executable:process.execPath}).executable, join(HERE, "test_export.js")],{capture_output:true,text:true}));
check("native: relocated payload and independent failure controls execute", (isDeepStrictEqual(exported.returncode,0)), slice(exported.stdout, -(200)));
check_skill_body(check, ROOT, {semantic: true, needles: ["Code 1 is the one that earns the convention", "Never install on the user's behalf", "Print the command; do not run it", "silent downgrade, and the user reads the output as if the full tool ran.", "Probe at the point of use, not at startup", "found by marker, not by path arithmetic", "excludes itself by skill directory, not by plugin name", "Substitution is for notation, never for a quoted literal"], floor: 4111});
check_ref_contracts(check, ROOT, [["probe-recipes.md", "strength table, per-state wording, version floor, and auth split", ["strictly stronger", "state 1 goes unread too", "numerically, field by field", "Authentication is not installation", "binary resolves, `gh auth status` returns non-zero", "Signed-out is state 1, not 2"], 2357]]);
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/probe.js": 23, "scripts/install.js": 71, "scripts/rules.json": 74, "scripts/export.js": 1}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
(coverage={"SKILL.md": 40, "references/probe-recipes.md": 24, "scripts/probe.js": 23, "scripts/install.js": 71, "scripts/rules.json": 74, "scripts/export.js": 1});
if(truth(isfile(join(ROOT, "SKILL.codex.md")))) {
(coverage["SKILL.codex.md"]=2);
} else {
check("계약 커버리지: Codex source variant is hosted separately", isfile(source_native), source_native);
}
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: coverage, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 40, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 206);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
