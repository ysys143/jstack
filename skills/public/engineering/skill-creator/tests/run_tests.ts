/** Owning behavior and protocol contracts, with measured deletion controls. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}


function range(start:number,stop?:number):number[]{if(stop===undefined){stop=start;start=0;}return Array.from({length:Math.max(0,stop-start)},(_,i)=>start+i);}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}
const ownsFixtureCache=!process.env.JSTACK_AUTHOR_FIXTURE_CACHE;
const fixtureCache=process.env.JSTACK_AUTHOR_FIXTURE_CACHE??temporaryDirectory();
process.env.JSTACK_AUTHOR_FIXTURE_CACHE=fixtureCache;
if(ownsFixtureCache)process.on('exit',()=>removeTree(fixtureCache));
function runFixtures(){
 const hash=createHash('sha256').update(process.version);
 for(const dir of [join(ROOT,'scripts'),join(dirname(SKILLS),'runtime')])for(const [base,,names] of walk(dir))for(const name of names.sort()){
  const path=join(base,name);hash.update(relative(dir,path));hash.update(readFileSync(path));
 }
 const cached=join(fixtureCache,hash.digest('hex')+'.json');
 try{const value=JSON.parse(readFileSync(cached,'utf8'));if(Number.isInteger(value.rc)&&typeof value.stdout==='string'&&typeof value.stderr==='string')return value;}catch{}
 const result=subprocessRun([process.execPath,join(ROOT,'scripts/tests/run_fixtures.js')],{cwd:ROOT});
 const value={rc:result.returncode,stdout:result.stdout,stderr:result.stderr};
 writeFileSync(cached,JSON.stringify(value));return value;
}
function* walk(root:string):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true});const dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>e.isFile()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}

function rows(text:any,head:any):any{
let body:any,r:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", body)).filter((r: any) => truth(((!contains(["Layer", "Build a", "Misuse"], strip(r)))))).map((r: any) => (r));
}
function trow(text:any,...cells:string[]):any{
let col:any,i:any,line:any,s:any;

for (let line of lines(text)) {
(s=strip(line));
if(truth(!truth(starts(s, "|")))) {
continue;
}
(i=0);
for (let col of split(strip(s, "|"), "|")) {
if(truth(((value:any)=>truth(value)?((contains(col, at(cells, i)))):value)((compare(i,length(cells),"<"))))) {
i+=1;
}
}
if(truth((isDeepStrictEqual(i,length(cells))))) {
return true;
}
}
return false;
}
function seq(text:any,...marks:string[]):any{
let at:any,i:any,m:any;

(at=-(1));
for (let m of marks) {
(i=text.indexOf(m, (at + 1)));
if(truth((compare(i,0,"<")))) {
return false;
}
(at=i);
}
return true;
}
function numbered_heads(text:any):any{

return findall("(?m)^## (\\d+)\\. (.+?)\\s*$", text);
}
function main():any{
let PLUGIN:any,_:any,_croot:any,aarch:any,ag_disk:any,ag_md:any,ag_tpl:any,again:any,args:any,bad:any,bad_wire:any,base:any,bcoh:any,before:any,body:any,bp_tools:any,bpr:any,c:any,cache:any,carch:any,cat:any,cdec:any,cfg:any,checker:any,cite:any,claude:any,clean:any,cmd:any,cmd_disk:any,cmd_md:any,cmd_tpl:any,cmds:any,codex:any,conv:any,d:any,d1:any,d2:any,data:any,dep:any,dep_body:any,dep_rows:any,dgov:any,dn:any,dp:any,e:any,env:any,env_needle:any,ev:any,event:any,ex:any,f:any,fm:any,fn:any,fns:any,forms:any,fp:any,fx:any,fx_dir:any,fx_hit:any,fx_pass:any,fx_res:any,fx_surface:any,fx_total:any,good:any,guarded:any,h:any,harch:any,hj:any,hk_disk:any,hk_md:any,hog:any,hog_surface:any,i:any,impl:any,item:any,jp:any,k:any,kind:any,kinds:any,label:any,lay:any,layers:any,live:any,manifest:any,matcher:any,mis:any,missing:any,n:any,name:any,named:any,native:any,native_path:any,nots:any,og:any,ogov:any,ok:any,others:any,out:any,owned:any,p:any,passed:any,pdp:any,planted:any,plc:any,r:any,rc:any,ref:any,rel:any,rm:any,seg:any,size:any,sk_md:any,skill:any,stg:any,stray:any,sub:any,surf:any,surf_text:any,swg:any,tag:any,td:any,tp:any,tpl:any,tpl_dir:any,trig:any,v:any,vtpl:any,why:any,wired:any,x:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(layers=read(join(ROOT, "references", "layers.md")));
(native_path=join(ROOT, "SKILL.codex.md"));
(native=(truth(isfile(native_path)) ? read(native_path) : ""));
check("native: common judgment and native call semantics have separate owners", ((value:any)=>truth(value)?((contains(native, "native tools actually exposed"))):value)(((contains(native, "canonical SKILL.md")))));
check("native: checks use actual artifacts and keep host enforcement explicit", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(native, "equivalent tool interception"))):value)(((contains(native, "does not claim")))):value)(((contains(native, "actual artifact")))));
check("placement: one canonical SKILL.md owns shared judgment", ((value:any)=>truth(value)?((contains(skill, "must not copy shared"))):value)(((contains(skill, "shared judgment and content in the owning `SKILL.md`")))));
check("placement: host overrides are limited to invocation-semantic differences", ((value:any)=>truth(value)?((contains(skill, "only when those semantics"))):value)((Array.from(["invocation", "tool arguments", "permission handling", "lifecycle"]).map((x: any) => (((contains(skill, x)))))).every((value:any)=>truth(value))));
check("placement: imports and references are portable within the package", ((value:any)=>truth(value)?((contains(skill, "outside the source checkout"))):value)(((contains(skill, "references\nand imports inside this package")))));
check("native: does not mistake Claude command paths for Codex tool names", ((value:any)=>truth(value)?((contains(native, "not names for Codex tools"))):value)((Array.from(["/jstack:test-plugin", "/jstack:validate", "/jstack:doctor author"]).map((x: any) => (((contains(native, x)))))).every((value:any)=>truth(value))));
check("cost: states that only name and description are always loaded", ((contains(skill, "every turn of every session"))));
check("cost: states that the cost is paid even when the skill does not fire", ((contains(skill, "whether or not the skill ever fires"))));
check("cost: states that everything else loads on demand", ((contains(skill, "loaded on demand"))));
(lay=rows(skill, "## One cost, four layers"));
check("cost: four-layer table has four rows", (isDeepStrictEqual(length(lay),4)), (pyStr(length(lay)) + " rows"));
for (let [tag, why] of [["L0", "description"], ["L1", "SKILL.md"], ["L2", "references"], ["L3", "scripts"]]) {
check(("cost: " + pyStr(tag) + " (" + pyStr(why) + ") row exists"), ((contains(skill, tag))));
}
check("cost: states that layer rules follow from the cost", ((contains(skill, "follows from the cost"))));
check("cost: gives a one-sentence criterion for description content", ((value:any)=>truth(value)?value:((contains(skill, "not needed to decide whether to fire"))))(((contains(skill, "not needed to decide\nwhether to fire")))));
(size=rows(layers, "## Sizing"));
check("layers: sizing table has four rows", (isDeepStrictEqual(length(size),4)), (pyStr(length(size)) + " rows"));
(mis=rows(layers, "## What each misuse costs"));
check("layers: misuse-cost table has four rows", (isDeepStrictEqual(length(mis),4)), (pyStr(length(mis)) + " rows"));
check("layers: states that two common misuses push in opposite directions", ((contains(layers, "push in opposite directions"))));
check("layers: gives the decision question in one sentence", ((contains(layers, "which side of the decision the text is on"))));
check("layers: gives the criterion for script content", ((contains(layers, "does not depend on the situation"))));
check("layers: explains that prose produces a different answer each time", ((contains(layers, "slightly different answer each time"))));
check("layers: states that a script encoding judgment reverses the boundary", ((contains(layers, "is encoding judgement"))));
check("layers: states that reference files are read whole", ((value:any)=>truth(value)?value:((contains(layers, "read from the top"))))(((contains(layers, "read from the\ntop")))));
check("layers: states that combining two topics makes half the file noise", ((contains(layers, "half of it is always noise"))));
check("layers: requires names based on decisions rather than format", ((contains(layers, "not after its format"))));
check("layers: states the description listing budget and keeps every other boundary in SKILL.md", ((contains(layers, "about 1% of the context window")) && (contains(layers, "every other boundary goes in SKILL.md"))));
(kinds=rows(skill, "## Skill, command, or agent"));
check("type: three-kind decision table has three rows", (isDeepStrictEqual(length(kinds),3)), (pyStr(length(kinds)) + " rows"));
check("type: agent criterion is a separate context", ((contains(skill, "its own context window"))));
check("type: a skill that only runs one script is classified as a command", ((contains(skill, "should be a command"))));
check("type: an agent without a separate context is classified as a skill", ((contains(skill, "should be a skill"))));
check("description: states when to fire and the one most confusable neighbour it yields to", ((value:any)=>truth(value)?((contains(skill, "most confusable neighbour"))):value)(((contains(skill, "when to fire")))));
check("description: explains that missing boundaries lead to proximity selection", ((value:any)=>truth(value)?value:((contains(skill, "picks by proximity"))))(((contains(skill, "picks by\nproximity")))));
check("description: states that such selection is not an intentional decision", ((contains(skill, "not a decision anybody made"))));
check("description: requires triggers in both languages", ((contains(skill, "in both languages"))));
check("description: states that one language misses expressions in the other", ((contains(skill, "reverse is equally true"))));
check("description: requires naming neighboring skills explicitly", ((contains(skill, "Name the neighbour explicitly"))));
check("description: states that this makes the boundary machine-checkable", ((contains(skill, "makes the boundary checkable"))));
check("description: naming a nonexistent neighbor fails the contract", ((contains(skill, "does not exist fails the contract"))));
check("description: limits it to one sentence plus two or three trigger phrases in 100 display columns", ((contains(skill, "at most 100 display columns")) && (contains(skill, "Korean character counts 2"))));
check("description: states the shared listing budget and puts every other boundary in the body", ((contains(skill, "about 1% of the context window")) && (contains(skill, "Every other boundary goes in the body"))));
check("command: one that only invokes a skill gets no description, and the menu shows its first body line", ((contains(skill, "gets none")) && (contains(skill, "`# /name — hint`")) && (contains(skill, "reserved for workflows the model must never start"))));
check("suite: a skill without a contract suite is prose", ((contains(skill, "with no contract suite is prose"))));
check("suite: requires testing claims rather than wording", ((contains(skill, "against the claims, not the wording"))));
check("suite: requires testing each rule's rationale", ((contains(skill, "its **reason** is stated"))));
check("suite: explains that rules without reasons are deleted next", ((contains(skill, "gets deleted next"))));
check("floor: requires measurement rather than selection", ((contains(skill, "**Floors are measured, not chosen.**"))));
check("floor: gives the measurement procedure", ((contains(skill, "reading the measured value"))));
check("floor: states that slack equals deletable body content", ((contains(skill, "amount of the body that can be deleted"))));
(nots=findall("(?m)^- \\*\\*(.+?)\\*\\*", skill));
check("prohibition: at least three prohibited forms are listed", (compare(length(nots),3,">=")), (pyStr(length(nots)) + " items"));
check("prohibition: router skills are forbidden", ((contains(skill, "routes to another skill"))));
check("prohibition: explains that users installed this plugin, not a skill map", ((value:any)=>truth(value)?value:((contains(skill, "map of skills they do not have"))))(((contains(skill, "not a\nmap of skills they do not have")))));
check("prohibition: requires absorbing and placing material properly", ((contains(skill, "place it properly"))));
check("prohibition: forbids reimplementing a maintained CLI", ((contains(skill, "reimplements a maintained CLI"))));
check("prohibition: forbids descriptions that merely describe a domain", ((contains(skill, "describes the domain"))));
check("prohibition: explains that such descriptions fire on everything and therefore nothing", ((contains(skill, "and therefore on nothing"))));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("boundary: named-neighbor population is nonempty", (compare(length(named),3,">=")), (pyStr(sorted(named))));
check("boundary: every named neighbor exists", !truth(missing), ("missing " + pyStr(missing)));
check("language: description contains Korean triggers", (compare(length(findall("[가-힣]+", fm)),4,">=")));
check("language: description also contains English triggers", ((value:any)=>truth(value)?((contains(fm, "command"))):value)(((contains(fm, "skill")))));
function sh(rel:string,...args:string[]):any{return subprocessRun([process.execPath,join(ROOT,rel),...args],{cwd:ROOT});}
fx_res=runFixtures();











(fx_hit=search("(?m)^(\\d+)/(\\d+) passed", at(fx_res, "stdout")));
([fx_pass, fx_total]=(truth(fx_hit) ? [Number(group(fx_hit, 1)), Number(group(fx_hit, 2))] : [0, 0]));
check("script: validate_plugin.js fixture suite completes", (isDeepStrictEqual(at(fx_res, "rc"),0)), slice(at(((value:any)=>truth(value)?value:["(no stderr)"])(lines(strip(at(fx_res, "stderr")))), -(1)), 0, 80));
check("script: all fixtures pass (positive passes, negatives fail, mutations detected)", ((value:any)=>truth(value)?(compare(fx_total,36,">=")):value)((isDeepStrictEqual(fx_pass,fx_total))), (pyStr(fx_pass) + "/" + pyStr(fx_total)));
for (let [label, rc] of [["--help", 0], ["missing path", 2]]) {
(r=sh("scripts/validate_plugin.js", (truth((isDeepStrictEqual(label,"--help"))) ? String(label) : join(tmpdir(), "author-suite-missing-plugin"))));
check(("script: validate_plugin.js " + pyStr(label) + " exits with " + pyStr(rc)), (isDeepStrictEqual(r.returncode,rc)), ("rc=" + pyStr(r.returncode)));
}
(guarded=["scripts/list_plugins.js", "scripts/register_local.js", "scripts/scaffold_plugin.js"]);
for (let rel of guarded) {
(body=read(join(ROOT, rel)));
check(("script: " + pyStr(rel) + " has a native CLI entry point"), ((contains(body, "isMain(import.meta.url)"))));
check(("script: " + pyStr(rel) + " has no hard-coded home path"), ((value:any)=>truth(value)?((!contains(body, "~/.claude/plugins"))):value)(((!contains(body, "/Users/")))));
}
for (let rel of guarded) {
(args=(truth(ends(rel, "list_plugins.js")) ? ["/nonexistent-marketplace-root"] : []));
(r=sh(rel, ...args));
check(("script: " + pyStr(rel) + " exits nonzero without arguments or with a missing path"), (!isDeepStrictEqual(r.returncode,0)), ("rc=" + pyStr(r.returncode)));
}
for (let rel of ["scripts/list_plugins.js"]) {
check(("script: " + pyStr(rel) + " allows JSTACK_MARKETPLACE_DIR to override the marketplace path"), ((contains(read(join(ROOT, rel)), "JSTACK_MARKETPLACE_DIR"))));
}
{const td=temporaryDirectory();try{(bad=sh("scripts/scaffold_plugin.js", join(td, "x"), "Bad_Name"));
check("script: scaffold rejects a non-kebab-case name (rc 2)", (isDeepStrictEqual(bad.returncode,2)), ("rc=" + pyStr(bad.returncode)));
(good=sh("scripts/scaffold_plugin.js", join(td, "p"), "probe-plugin"));
(manifest=join(td, "p", ".claude-plugin", "plugin.json"));
check("script: scaffold creates plugin.json", ((value:any)=>truth(value)?isfile(manifest):value)((isDeepStrictEqual(good.returncode,0))), ("rc=" + pyStr(good.returncode)));
check("script: scaffold writes the name into the manifest", ((value:any)=>truth(value)?((contains(read(manifest), "\"probe-plugin\""))):value)(isfile(manifest)));
(before=(truth(isfile(manifest)) ? read(manifest) : ""));
if(truth(isfile(manifest))) {
{const f=fileHandle(manifest,"a");f.write("\n");}
}
(again=sh("scripts/scaffold_plugin.js", join(td, "p"), "probe-plugin-2"));
check("script: scaffold does not overwrite an existing plugin", ((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(read(manifest), "\"probe-plugin-2\""))):value)((isDeepStrictEqual(read(manifest),(before + "\n")))):value)(isfile(manifest)), ("rc=" + pyStr(again.returncode)));}finally{removeTree(td);}}

(tpl="references/templates");
for (let [name, event, cmd] of [["formatting-hook-template", "PostToolUse", "format.js"], ["notification-hook-template", "PostToolUse", "notify.js"], ["validation-hook-template", "PreToolUse", "validate_template.js"]]) {
(hj=join(ROOT, tpl, name, "hooks.json"));
try {
(data=JSON.parse(read(hj)));
} catch(error) {
(data={});
}
(ev=((value:any)=>truth(value)?value:[])((((value:any)=>truth(value)?value:{})((data["hooks"] ?? null))[event] ?? null)));
check(("template: " + pyStr(name) + "/hooks.json declares " + pyStr(event) + " with the real schema"), ((value:any)=>truth(value)?(Array.from(ev).map((e: any) => (((value:any)=>truth(value)?(e["hooks"] ?? null):value)(((contains(e, "matcher"))))))).every((value:any)=>truth(value)):value)(truth(ev)));
(cmds=Array.from(ev).flatMap((e: any) => Array.from(((value:any)=>truth(value)?value:[])((e["hooks"] ?? null))).map((h: any) => ((h["command"] ?? "")))));
check(("template: " + pyStr(name) + "/hooks.json invokes " + pyStr(cmd) + " relative to CLAUDE_PLUGIN_ROOT"), (Array.from(cmds).map((c: any) => (((value:any)=>truth(value)?((contains(c, cmd))):value)(((contains(c, "${CLAUDE_PLUGIN_ROOT}"))))))).some((value:any)=>truth(value)), (pyStr(cmds)));
check(("template: " + pyStr(name) + "/hooks.json has no nonexistent name/config fields"), ((value:any)=>truth(value)?!truth((Array.from(ev).map((e: any) => (((value:any)=>truth(value)?value:((contains(e, "config"))))(((contains(e, "name"))))))).some((value:any)=>truth(value))):value)(truth(ev)));
}
for (let [rel, env_needle] of [[(pyStr(tpl) + "/formatting-hook-template/format.js"), "HOOK_INDENT"], [(pyStr(tpl) + "/notification-hook-template/notify.js"), "HOOK_RATE_LIMIT_MAX_PER_HOUR"], [(pyStr(tpl) + "/validation-hook-template/validate_template.js"), "HOOK_SEVERITY"]]) {
(body=read(join(ROOT, rel)));
check(("template: " + pyStr(rel) + " reads configuration from environment variable " + pyStr(env_needle)), ((contains(body, env_needle))));
check(("template: " + pyStr(rel) + " does not read the fake hooks.json config schema"), ((value:any)=>truth(value)?((value:any)=>truth(value)?(compare(length(body),0,">")):value)(((!contains(body, ".hooks[]")))):value)(((!contains(body, "select(.name")))));
check(("template: " + pyStr(rel) + " reads the hook payload from stdin"), ((contains(body, "readFileSync(0")) && (contains(body, "JSON.parse"))));
(r=subprocessRun([process.execPath,"--check",join(ROOT,rel)]));
check(("template: " + pyStr(rel) + " passes syntax validation"), (isDeepStrictEqual(r.returncode,0)), slice(strip(r.stderr), -(80)));
}
{const td=temporaryDirectory();try{(jp=join(td, "x.json"));
{const f=fileHandle(jp,"w");f.write("{\"a\":{\"b\":1}}");}
(env=({...process.env, HOOK_INDENT: "4"}));
(r=subprocessRun([process.execPath, join(ROOT, tpl, "formatting-hook-template", "format.js"), "x.json"],{cwd:td,env:env,capture_output:true,text:true}));
(out=(truth(isfile(jp)) ? read(jp) : ""));
check("template: format.js applies four-space indentation with HOOK_INDENT=4", ((value:any)=>truth(value)?((contains(out, "\n    \"a\""))):value)((isDeepStrictEqual(r.returncode,0))), ("rc=" + pyStr(r.returncode)));}finally{removeTree(td);}}
(surf=join(ROOT, "references", "package-surface.yaml"));
(checker=join(ROOT, "scripts", "check_package_surface.js"));
(PLUGIN=dirname(SKILLS));
function surface(...args:string[]):any{return subprocessRun([process.execPath,checker,...args],{cwd:ROOT});}
(live=surface("--root", PLUGIN, "--surface", surf));
check("surface: live tree matches the declaration (rc 0)", (isDeepStrictEqual(live.returncode,0)), slice(at(((value:any)=>truth(value)?value:[("rc=" + pyStr(live.returncode))])(lines(strip(live.stderr))), -(1)), 0, 120));
check("surface: success report gives zero unclassified files and a category count", ((value:any)=>truth(value)?((contains(live.stdout, "categories"))):value)(((contains(live.stdout, "0 unclassified")))), slice(at(((value:any)=>truth(value)?value:["(no output)"])(lines(strip(live.stdout))), 0), 0, 80));
(surf_text=read(surf));
check("surface: declaration fails closed on unclassified files", ((contains(surf_text, "unclassified: fail"))));
check("surface: declaration defines a catch-all coverage threshold", ((contains(surf_text, "max_share_per_pattern"))));
for (let cat of ["skill-doc", "reference", "script", "test", "hook", "command", "agent", "manifest", "frozen"]) {
check(("surface: " + pyStr(cat) + " category is declared"), ((contains(surf_text, ("\n  " + pyStr(cat) + ":")))));
}
{const td=temporaryDirectory();try{(fx=join(td, "plug"));
for (let rel of ["commands/a.md", "agents/b.md", "skills/s/SKILL.md"]) {
mkdirSync(join(fx, dirname(rel)),{recursive:true});
{const f=fileHandle(join(fx, rel),"w");f.write("픽스처\n");}
}
(fx_surface=join(td, "surface.yaml"));
{const f=fileHandle(fx_surface,"w");f.write("policy:\n  unclassified: fail\n  max_share_per_pattern: 0.5\ncategories:\n  command:\n    - \"commands/*.md\"\n  agent:\n    - \"agents/*.md\"\n  skill-doc:\n    - \"skills/*/SKILL.md\"\n");}
(clean=surface("--root", fx, "--surface", fx_surface));
check("surface: fully classified fixture returns rc 0", (isDeepStrictEqual(clean.returncode,0)), ("rc=" + pyStr(clean.returncode)));
{const f=fileHandle(join(fx, "stray.txt"),"w");f.write("어느 범주에도 없는 파일\n");}
(planted=surface("--root", fx, "--surface", fx_surface));
check("surface: one planted unclassified file returns rc 1", (isDeepStrictEqual(planted.returncode,1)), ("rc=" + pyStr(planted.returncode)));
check("surface: reports the unclassified file path", ((contains(planted.stderr, "stray.txt"))));
(hog_surface=join(td, "hog.yaml"));
{const f=fileHandle(hog_surface,"w");f.write("policy:\n  unclassified: fail\n  max_share_per_pattern: 0.5\ncategories:\n  everything:\n    - \"**\"\n");}
(hog=surface("--root", fx, "--surface", hog_surface));
check("surface: a pattern covering everything returns rc 1", (isDeepStrictEqual(hog.returncode,1)), ("rc=" + pyStr(hog.returncode)));
check("surface: reports the catch-all pattern's share", ((contains(hog.stderr, "100%"))));}finally{removeTree(td);}}
(ref=(...p:string[])=>read(join(ROOT, "references", ...p)));
([ag_md, cmd_md, hk_md, sk_md]=[ref("agent.md"), ref("command.md"), ref("hook.md"), ref("skill.md")]);
([swg, stg]=[ref("skill-writing-guide.md"), ref("skill-testing-guide.md")]);
([cdec, plc, bpr]=[ref("component-decision.md"), ref("placement.md"), ref("browser-priority.md")]);
(dgov=ref("deprecated-governance.md"));
(og=(n:any)=>ref("organizational-guides", n));
([aarch, bcoh, carch]=[og("agent-architecture.md"), og("bundle-coherence-guide.md"), og("command-architecture.md")]);
([harch, ogov, pdp]=[og("hook-architecture.md"), og("organizational-governance.md"), og("plugin-design-patterns.md")]);
(tpl_dir=join(ROOT, "references", "templates"));
(tp=(n:any)=>read(join(tpl_dir, n)));
check("reference content: layers binds the Description row to its oversize symptom", trow(layers, "Description", "One sentence plus two or three trigger phrases", "It explains how to do the work"));
check("reference content: layers binds the script row to its oversize symptom", trow(layers, "A script", "One deterministic job", "It asks the caller to make a choice"));
check("reference content: layers binds procedures in descriptions to always-on cost", trow(layers, "Procedure in the description", "Paid on every turn of every session"));
check("reference content: layers binds determinism in prose to repeated derivation", trow(layers, "Determinism left in prose", "re-derives it each time"));
check("reference content: command procedure preserves Phase 1 through 8 order", seq(cmd_md, "### Phase 1: Context Detection", "### Phase 2: Command Discovery", "### Phase 3: Configuration", "### Phase 4: Template Selection", "### Phase 5: Generation", "### Phase 6: Integration", "### Phase 7: Validation", "### Phase 8: Completion"));
check("reference content: command template drops the description when a skill carries the intent", ((contains(cmd_md, "Drop the `description` line when a public skill carries the intent")) && (contains(cmd_md, "`description:` with no value fails"))));
(cmd_tpl=new Set(findall("([\\w-]+)-command-template\\.md", cmd_md)));
(cmd_disk=new Set(Array.from(readdirSync(tpl_dir)).filter((n: any) => truth(ends(n, "-command-template.md"))).map((n: any) => (slice(n, 0, -(length("-command-template.md")))))));
check("reference content: command's referenced command templates exactly match the tree", ((value:any)=>truth(value)?truth(cmd_disk):value)((isDeepStrictEqual(cmd_tpl,cmd_disk))), ("document " + pyStr(sorted(cmd_tpl)) + " vs tree " + pyStr(sorted(cmd_disk))));
check("reference content: agent role table binds Analyzer to input, output, and model", trow(ag_md, "Analyzer", "Complex data", "Assessment/insights", "Sonnet/Opus", "Debugging, code review"));
check("reference content: agent role table binds Validator to input, output, and model", trow(ag_md, "Validator", "Data + rules", "Pass/fail + reasons", "Haiku/Sonnet", "Quality checks"));
(ag_tpl=new Set(findall("`([\\w-]+-agent-template\\.md)`", ag_md)));
(ag_disk=new Set(Array.from(readdirSync(tpl_dir)).filter((n: any) => truth(ends(n, "-agent-template.md"))).map((n: any) => (n))));
check("reference content: agent's referenced templates exactly match the tree", ((value:any)=>truth(value)?truth(ag_disk):value)((isDeepStrictEqual(ag_tpl,ag_disk))), ("document " + pyStr(sorted(ag_tpl)) + " vs tree " + pyStr(sorted(ag_disk))));
for (let [kind, trig, why] of [["Validation", "PreToolUse", "Block invalid tool calls"], ["Formatting", "PostToolUse", "Transform tool output"], ["Augmentation", "PreToolUse", "Modify tool parameters"]]) {
check(("reference content: hook table binds " + pyStr(kind) + " to " + pyStr(trig)), trow(hk_md, kind, trig, why));
}
check("reference content: hook procedure preserves Phase 1 through 5 order", seq(hk_md, "### Phase 1: Context Detection", "### Phase 2: Hook Discovery", "### Phase 3: Hook Configuration", "### Phase 4: Template Selection", "### Phase 5: Hook Generation"));
(wired=findall("(?m)^\\| \\w+ \\| `([\\w-]+)/hooks\\.json` \\| `([\\w-]+)/([\\w.]+)` \\|$", hk_md));
(hk_disk=new Set(Array.from(readdirSync(tpl_dir)).filter((n: any) => truth(((value:any)=>truth(value)?isdir(join(tpl_dir, n)):value)(ends(n, "-hook-template")))).map((n: any) => (n))));
check("reference content: hook wiring table covers every hook template directory", ((value:any)=>truth(value)?truth(hk_disk):value)((isDeepStrictEqual(new Set(Array.from(wired).map(([d, _one, _two]: any) => (d))),hk_disk))), ("document " + pyStr(sorted(Array.from(wired).map(([d, _one, _two]: any) => (d)))) + " vs tree " + pyStr(sorted(hk_disk))));
(bad_wire=[]);
for (let [d1, d2, impl] of wired) {
(hj=join(tpl_dir, d1, "hooks.json"));
try {
(cmds=Array.from(Object.values(((value:any)=>truth(value)?value:{})((JSON.parse(read(hj))["hooks"] ?? null)))).flatMap((ev: any) => Array.from(ev).flatMap((e: any) => Array.from(((value:any)=>truth(value)?value:[])((e["hooks"] ?? null))).map((h: any) => ((h["command"] ?? ""))))));
} catch(error) {
(cmds=[]);
}
if(truth(((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:!truth((Array.from(cmds).map((c: any) => (((contains(c, impl)))))).some((value:any)=>truth(value))))(!truth(isfile(join(tpl_dir, d1, impl)))))((!isDeepStrictEqual(d1,d2))))) {
bad_wire.push((pyStr(d1) + "/" + pyStr(impl)));
}
}
check("reference content: hook wiring implementations exist and hooks.json invokes them", ((value:any)=>truth(value)?!truth(bad_wire):value)(truth(wired)), (truth(bad_wire) ? ("mismatch " + pyStr(bad_wire)) : (pyStr(length(wired)) + " rows")));
check("reference content: skill procedure preserves Step 0 through 7 order", seq(sk_md, "## Step 0: Determine Scope", "## Step 1: Define the Skill", "## Step 2: Inspect Existing Components", "## Step 3: Choose Placement", "## Step 4: Write `SKILL.md`", "## Step 5: Select Delivery", "## Step 6: Deliver", "## Step 7: Report Completion"));
check("reference content: skill scope table binds locations to Project and Organization", trow(sk_md, "Location", "{project}/.claude/skills/", "A plugin marketplace"));
check("reference content: skill scope table binds reach to Project and Organization", ((value:any)=>truth(value)?((value:any)=>truth(value)?(Array.from(["02-planning-and-design.md", "03-skill-structure.md", "04-writing-instructions.md", "07-patterns.md"]).map((p: any) => (((contains(sk_md, p)))))).every((value:any)=>truth(value)):value)(((contains(sk_md, "Recommended: **{1 or 2}**, because {reason}")))):value)(trow(sk_md, "Reach", "Current project only", "All projects for installed users")));
check("reference content: skill-writing-guide has numbered sections 1 through 9", (isDeepStrictEqual(Array.from(numbered_heads(swg)).map(([n, _]: any) => (n)),Array.from(range(1, 10)).map((n: any) => (pyStr(n))))));
check("reference content: skill-testing-guide has numbered sections 1 through 8", (isDeepStrictEqual(Array.from(numbered_heads(stg)).map(([n, _]: any) => (n)),Array.from(range(1, 9)).map((n: any) => (pyStr(n))))));
check("reference content: skill-writing-guide gives routing rules in order", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(swg, "2095991462416490862"))):value)(((contains(swg, "All three of three tests create the same helper script")))):value)(((contains(swg, "When tracked changes are required")))):value)(((contains(swg, "ALWAYS use pdfplumber")))):value)(seq(swg, "State both what the skill does", "Include a boundary for similar requests", "avoid pressuring the model to invoke it")));
check("reference content: skill-testing-guide binds qualitative and quantitative evaluations", ((value:any)=>truth(value)?trow(stg, "Quantitative", "Automated assertion scoring", "File creation"):value)(trow(stg, "Qualitative", "A user reviews the deliverable", "Style, design")));
check("reference content: skill-testing-guide gives the five-step iteration loop in order", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(stg, "40% held-out test sets"))):value)(((contains(stg, "20 queries into 60% training")))):value)(((contains(stg, "100% of the time")))):value)(((contains(stg, "2-3 prompts")))):value)(seq(stg, "1. Revise the skill.", "2. Rerun every test", "3. Show the results", "4. Collect feedback.", "5. Revise and repeat.")));
check("reference content: component-decision binds hooks to blocking execution", trow(cdec, "Hook", "Harness invokes on an event", "Can block execution", "Runs on every matching event"));
check("reference content: component-decision binds agents to a separate context", trow(cdec, "Agent", "Delegator invokes it", "Separate context window", "highest unit cost"));
check("reference content: component-decision gives its two decision axes in order", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(cdec, "9 agent types accounted for about 74%"))):value)(((contains(cdec, "accumulated 19 layer-0 components")))):value)(seq(cdec, "1. **When is it invoked?**", "2. **What is the cost of a violation?**")));
for (let [item, claude, codex] of [["User skills", "~/.claude/skills/", "~/.codex/skills/"], ["Instruction file", "CLAUDE.md", "AGENTS.md"], ["Settings", "settings.json", "config.toml"]]) {
check(("reference content: placement binds " + pyStr(item) + " to Claude and Codex values"), trow(plc, item, claude, codex));
}
check("reference content: placement binds shared and host-specific distribution", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?trow(plc, "Enable/disable", "4-state `skillOverrides`"):value)(trow(plc, "`agents/openai.yaml` or `$skill-name`", "Codex conventions")):value)(trow(plc, "`Task(` or `subagent_type`", "Claude subagent invocation")):value)(trow(plc, "Host-specific", "host tools, configuration, or subagents", "Owning host only")):value)(trow(plc, "Shared", "external CLIs, files, or APIs", "Every compatible host directory")));
check("reference content: placement gives all three distribution invariants", seq(plc, "Count host-specific real directories", "Require 0 broken links", "Require 0 duplicate names"));
check("reference content: browser-priority binds the default to agent-browser", trow(bpr, "Default", "agent-browser"));
check("reference content: browser-priority binds authenticated sessions to claude-in-chrome", trow(bpr, "Existing authenticated browser session or cookies are required", "claude-in-chrome"));
check("reference content: browser-priority binds profiling to chrome-devtools", trow(bpr, "Performance profiling, Lighthouse, or heap snapshots", "chrome-devtools"));
(bp_tools=new Set(Array.from(findall("(?s)"+"(agent-browser|claude-in-chrome|chrome-devtools|playwright)",bpr)).map((x: any) => (lower(x)))));
check("reference content: browser-priority covers exactly four tools", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(Array.from(["returned 7 lines", "5 were false positives", "remaining 2", "measured count was 0"]).map((x: any) => (((contains(bpr, x)))))).every((value:any)=>truth(value)):value)(((contains(bpr, "스크린샷|스크랩|폼 채우|E2E|브라우저|크롤|scrape|screenshot")))):value)(((contains(bpr, "additional 23 tool schemas")))):value)((isDeepStrictEqual(bp_tools,new Set(["agent-browser", "claude-in-chrome", "chrome-devtools", "playwright"])))), (pyStr(sorted(bp_tools))));
(dep_body=at(split(dgov, "## Seven Retired Artifacts", 1), -(1)));
(dep_rows=findall("(?m)^\\| (\\d+) \\|", dep_body));
(dep=findall("(?m)^\\| (\\d+) \\| `([^`]+)`", dep_body));
check("reference content: deprecated-governance preserves seven numbered retired artifacts", ((value:any)=>truth(value)?(isDeepStrictEqual(dep,[["1", "plugin-generator/references/anthropic-skills-guide/"], ["2", "generate.md"], ["3", "design.md"], ["4", "from-codebase.md"], ["5", "from-docs.md"], ["6", "from-session.md"], ["7", "sync-guide.md"]])):value)((isDeepStrictEqual(dep_rows,Array.from(range(1, 8)).map((n: any) => (pyStr(n)))))), ("rows " + pyStr(dep_rows) + ", named " + pyStr(dep)));
check("reference content: deprecated-governance states the archive boundaries", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(dgov, "nonexistent `toolMatcherRegex` field"))):value)(((contains(dgov, "0 invocations")))):value)(((contains(dgov, "processed material moves to `completed/`")))):value)(((contains(dgov, "gitignored and never shipped")))):value)(((contains(dgov, "decision list, not that archive")))):value)(seq(dgov, "gitignored and never shipped", "Nothing inside it is canonical", "retirement lifecycle")));
check("reference content: agent-architecture binds haiku to fastest, lowest cost, and simple extraction", trow(aarch, "`haiku`", "Fastest", "Lowest", "Simple extraction"));
check("reference content: agent-architecture binds opus to slowest, highest cost, and complex reasoning", trow(aarch, "`opus`", "Slowest", "Highest", "Complex reasoning"));
check("reference content: agent-architecture binds model to an optional frontmatter field", trow(aarch, "`model`", "No", "Model tier (haiku/sonnet/opus)", "`sonnet` (default)"));
check("reference content: bundle-coherence gives five cohesion principles in order", seq(bcoh, "### 1. Single Responsibility Principle", "### 2. Shared Domain", "### 3. Interaction Benefit", "### 4. Maintenance Unity", "### 5. User Mental Model"));
check("reference content: bundle-coherence gives five separation reasons in order", seq(bcoh, "### Reason 1: Different Update Cycles", "### Reason 2: Rarely Used Components", "### Reason 3: Different Owners", "### Reason 4: Unrelated Domains", "### Reason 5: Security Boundaries"));
check("reference content: bundle-coherence gives five antipatterns in order", seq(bcoh, "### 1. Kitchen Sink Plugin", "### 2. Premature Bundling", "### 3. Forced Separation", "### 4. Cross-Concern Mixing", "### 5. Micro-Plugins"));
check("reference content: command-architecture gives four command tiers in order", seq(carch, "### 1. Wizard Commands (Interactive)", "### 2. Generator Commands (Templated)", "### 3. Orchestrator Commands (Coordination)", "### 4. Utility Commands (Direct)"));
check("reference content: command-architecture binds Input validation to immediate failure", trow(carch, "Input", "Syntax, required fields", "Immediately"));
check("reference content: command-architecture binds Coherence validation to after execution", trow(carch, "Coherence", "Plugin bundle consistency", "After execution"));
check("reference content: hook-architecture binds exit code 0 to allowing execution", trow(harch, "`0`", "Success", "PreToolUse: Allow tool execution"));
check("reference content: hook-architecture binds nonzero exit codes to blocking execution", trow(harch, "`1-255`", "Failure", "PreToolUse: **BLOCK** tool execution"));
check("reference content: hook-architecture binds matcher to a tool-name regex", trow(harch, "`matcher`", "Hook group", "Yes", "Regex matched against the tool name"));
check("reference content: hook-architecture binds git commits to Bash plus content inspection", trow(harch, "Git commits only", "`Bash`", "git commit"));
for (let [kind, conv, ex] of [["Commands", "{verb}-{noun}.md", "add-skill.md"], ["Scripts", "{verb}_{noun}.js", "validate_plugin.js"], ["Templates", "{type}-template/", "validation-hook-template/"]]) {
check(("reference content: organizational-governance binds " + pyStr(kind) + " naming rule to its example"), trow(ogov, kind, conv, ex));
}
check("reference content: plugin-design-patterns gives six patterns in order", seq(pdp, "## 1. Configuration Pattern", "## 2. Integration Pattern", "## 3. Analysis Pattern", "## 4. Development Workflow Pattern", "## 5. Documentation Pattern", "## 6. Validation & Quality Pattern"));
check("reference content: plugin-design-patterns binds Analysis to 3-8 critical agents", trow(pdp, "**Agents**", "3-8", "Specialized analyzers (critical)"));
check("reference content: plugin-design-patterns binds Configuration to 2-4 commands", trow(pdp, "**Commands**", "2-4", "`setup`, `configure`, `update-config`"));
check("reference content: analyzer template orders role, responsibilities, framework, dimensions, and severity", seq(tp("analyzer-agent-template.md"), "## Role", "## Core Responsibilities", "## Analysis Framework", "## Analysis Dimensions", "## Severity Levels", "## Context Awareness"));
check("reference content: analyzer template gives four core responsibilities in order", seq(tp("analyzer-agent-template.md"), "1. **Analysis**:", "2. **Pattern Detection**:", "3. **Assessment**:", "4. **Reporting**:"));
check("reference content: extractor template gives four extraction phases in order", seq(tp("extractor-agent-template.md"), "### 1. Scan Phase", "### 2. Parse Phase", "### 3. Validate Phase", "### 4. Transform Phase"));
check("reference content: extractor template gives four ambiguity rules in order", seq(tp("extractor-agent-template.md"), "1. **Check Context**:", "2. **Apply Heuristics**:", "3. **Use Defaults**:", "4. **Flag Uncertainty**:"));
(vtpl=tp("validator-agent-template.md"));
check("reference content: validator template binds each rule to severity and auto-fix policy", ((value:any)=>truth(value)?((value:any)=>truth(value)?trow(vtpl, "{R003}", "LOW", "Yes"):value)(trow(vtpl, "{R002}", "MEDIUM", "Yes")):value)(trow(vtpl, "{R001}", "HIGH", "No")));
check("reference content: validator template gives four validation categories in order", seq(vtpl, "### 1. Schema Validation", "### 2. Convention Validation", "### 3. Coherence Validation", "### 4. Quality Validation"));
check("reference content: generator template gives seven generation steps in order", seq(tp("generator-command-template.md"), "### Step 1: Parse Arguments", "### Step 2: Check Prerequisites", "### Step 3: Load Template", "### Step 4: Apply Transformations", "### Step 5: Generate Files", "### Step 6: Post-Generation", "### Step 7: Report Results"));
check("reference content: orchestrator template gives five phases in order", seq(tp("orchestrator-command-template.md"), "### Phase 1: Initialization", "### Phase 2: Stage Execution", "### Phase 3: Result Aggregation", "### Phase 4: Post-Processing", "### Phase 5: Report"));
check("reference content: wizard template gives five phases in order", seq(tp("wizard-command-template.md"), "### Phase 1: Introduction", "### Phase 2: Requirement Gathering", "### Phase 3: Confirmation", "### Phase 4: Execution", "### Phase 5: Next Steps"));
for (let name of ["formatting-hook-template", "notification-hook-template", "validation-hook-template"]) {
try {
(cfg=JSON.parse(read(join(tpl_dir, name, "hooks.json"))));
(ev=Object.keys(at(cfg, "hooks"))[0]);
(matcher=at(at(at(at(cfg, "hooks"), ev), 0), "matcher"));
} catch(error) {
(ev=null);(matcher=null);
}
(rm=read(join(tpl_dir, name, "README.md")));
check(("reference content: " + pyStr(name) + "/README reproduces the live hooks.json event and matcher"), ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(rm, ("\"matcher\": \"" + pyStr(matcher) + "\"")))):value)(((contains(rm, ("\"" + pyStr(ev) + "\": ["))))):value)(truth(ev)), ("live " + pyStr(ev) + "/" + pyStr(matcher)));
check(("reference content: " + pyStr(name) + "/README explains whether the event can block"), ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(rm, "lifecycle events"))):value)(((contains(rm, ("`" + pyStr(ev) + "`"))))):value)(truth(ev)));
}
(cite={"SKILL.md": read(join(ROOT, "SKILL.md"))});
(owned=[]);
for (let sub of ["references", "scripts"]) {
(base=join(ROOT, sub));
if(truth(!truth(isdir(base)))) {
continue;
}
for (let [dp, dn, fns] of walk(base)) {
dn.splice(0,dn.length,...Array.from(dn).filter((d: any) => truth(((!contains(["__pycache__", ".ruff_cache"], d))))).map((d: any) => (d)));
for (let n of sorted(fns)) {
if(truth(ends(n, [".pyc", ".lines"]))) {
continue;
}
(r=replace(relative(ROOT,join(dp, n)), sep, "/"));
try {
(cite[r]=read(join(ROOT, r)));
} catch(error) {
continue;
}
if(truth(((value:any)=>truth(value)?((!contains(("/" + pyStr(r)), "/tests/"))):value)(!truth(starts(n, [".", "_"]))))) {
owned.push(r);
}
}
}
}
(stray=[]);
for (let r of owned) {
(seg=split(r, "/"));
(forms=Array.from(range((length(seg) - 1))).map((i: any) => (joinText("/", slice(seg, i)))));
(others=joinText("\n", Array.from(Object.entries(cite)).filter(([k, v]: any) => truth((!isDeepStrictEqual(k,r)))).map(([k, v]: any) => (v))));
if(truth(!truth((Array.from(forms).map((f: any) => (((contains(others, f)))))).some((value:any)=>truth(value))))) {
stray.push(r);
}
}
check("citation: supporting files use prefixed relative paths (zero orphans)", !truth(stray), (truth(stray) ? ("orphans " + pyStr(stray)) : (pyStr(length(owned)) + " files")));
check_skill_body(check, ROOT, {semantic: true, needles: ["every turn of every session", "**Floors are measured, not chosen.**", "Name the neighbour explicitly", "routes to another skill", "with no contract suite is prose"], floor: 6261});
check_ref_contracts(check, ROOT, [["layers.md", "layer sizes, misuse costs, script criteria, and reference naming", ["push in opposite directions", "does not depend on the situation", "half of it is always noise", "not after its format"], 1553], ["agent.md", "agent creation from context detection through generation", ["Add a new intelligent agent to an existing plugin with guided configuration.", "Agent roles (analyzer, extractor, validator, generator)"], 9596], ["command.md", "command creation through detection, configuration, templates, and generation", ["Interactive wizard for adding commands to plugins.", "(wizard|generator|orchestrator|utility)"], 1346], ["hook.md", "hook creation covering name, type, trigger, matcher, and language", ["Add a new hook to an existing plugin with guided configuration.", "(lifecycle event handlers)"], 8896], ["skill.md", "skill creation from scope decision through delivery", ["Add a skill to an existing plugin or create a plugin to contain it.", "## Step 0: Determine Scope"], 5018], ["skill-writing-guide.md", "description routing patterns and body style", ["A description is a short situation statement used for automatic selection.", "Include a boundary for similar requests that should not select it.", "When asked only for an audit, report findings and proposed corrections without editing.", "Do not repeatedly ask for approval for already authorized, reversible edits.", "without editing"], 5220], ["skill-testing-guide.md", "with-skill and baseline validation with an iteration loop", ["write -> execute -> evaluate -> improve -> retest", "Compare With-Skill and Baseline Runs"], 6510], ["component-decision.md", "two decision axes and each layer's unique ability", ["If the unique-ability cell is empty", "Can block execution", "Without a separate-context need, it is an expensive skill."], 2563], ["placement.md", "one authority, linked distribution, reach, and host contracts", ["Keep one real skill directory", "A sync tool must never replace those directories.", "Automatic classification produces false positives and negatives."], 3565], ["browser-priority.md", "four browser tools and the reasons for their order", ["Do not use the Playwright MCP", "The legacy plugin tree contained no", "Inject this guidance only when a prompt concerns"], 2567], ["deprecated-governance.md", "seven retired artifacts and negative-corpus limits", ["only when a later cycle consumes it as gate input", "describe what is true now", "Inputs should be arguments;"], 3101]], {freeze_dir: "tests/refs/references"});
check_ref_contracts(check, ROOT, [["agent-architecture.md", "agent-versus-skill decisions and orchestration patterns", ["Comprehensive guide to Claude Code agents: when to use them, how to structure them, and orchestration patterns.", "Read-only by default (unless write tools explicitly allowed)"], 9861], ["bundle-coherence-guide.md", "criteria for bundling or separating plugins", ["Decision framework for determining when to bundle components into a single plugin vs. separating them into multiple plugins.", "Users think of components as **one cohesive thing**."], 8438], ["command-architecture.md", "wizard, generator, and orchestrator command tiers", ["Commands are the primary user interface layer in the plugin system.", "Requires domain expertise to choose correctly"], 5753], ["hook-architecture.md", "hook lifecycle, matcher, real hooks.json schema, and contracts", ["Comprehensive guide to Claude Code hooks: lifecycle, configuration, implementation patterns, and best practices.", "`matcher` only ever tests the **tool name**."], 11507], ["organizational-governance.md", "naming, file organization, and version policy", ["This guide defines naming conventions, file organization, versioning, and quality standards for organization plugin development.", "Use verb-noun or domain-verb pattern"], 8073], ["plugin-design-patterns.md", "six bundle patterns and component combinations", ["This guide describes six common plugin patterns for organizational plugin development.", "Manage system settings, project configurations, or environment setup with guided wizards and automation."], 8127]], {subdir: "references/organizational-guides", freeze_dir: "tests/refs/organizational-guides"});
check_ref_contracts(check, ROOT, [["analyzer-agent-template.md", "analyzer agent skeleton", ["Template for creating agents that analyze code, plugins, or project structure.", "Agent prompt files go in `.claude-plugin/agents/{agent-name}.md`"], 5630], ["extractor-agent-template.md", "extractor agent skeleton", ["Template for agents that extract structured information from unstructured sources.", "Extractor agents parse, interpret, and transform unstructured data (docs, code, conversations) into structured formats."], 3816], ["validator-agent-template.md", "validator agent skeleton", ["Template for agents that validate correctness, consistency, and compliance.", "Validator agents check data, code, or artifacts against rules, schemas, and best practices."], 4867], ["generator-command-template.md", "generator command skeleton", ["Template for commands that generate files/code from templates.", "Generator commands create files by applying templates with variable substitution."], 5229], ["orchestrator-command-template.md", "orchestrator command skeleton", ["Template for commands that coordinate multiple agents, tools, or workflows.", "Orchestrator commands manage complex multi-stage pipelines, delegating work to specialized agents and coordinating results."], 5763], ["wizard-command-template.md", "wizard command skeleton", ["Template for interactive multi-step commands that guide users through complex workflows.", "Wizard commands use progressive disclosure to gather requirements, guide decisions, and execute complex operations."], 5875]], {subdir: "references/templates", freeze_dir: "tests/refs/templates"});
check_ref_contracts(check, ROOT, [["README.md", "formatting hook skeleton with hooks.json and format.js", ["This template provides a code/document formatting hook for Claude Code plugins.", "Formatting hooks automatically format code, JSON, markdown, or other files according to project standards."], 5092]], {subdir: "references/templates/formatting-hook-template", freeze_dir: "tests/refs/templates/formatting-hook-template"});
check_ref_contracts(check, ROOT, [["README.md", "notification hook skeleton with hooks.json and notify.js", ["This template provides event notification hooks for Claude Code plugins.", "Notification hooks send alerts, update status, record events, or trigger external integrations when plugin actions occur."], 7324]], {subdir: "references/templates/notification-hook-template", freeze_dir: "tests/refs/templates/notification-hook-template"});
check_ref_contracts(check, ROOT, [["README.md", "validation hook skeleton with hooks.json and validate_template.js", ["This Node.js 20+ template provides the validator interface, diagnostics,", "until you add rules."], 7185]], {subdir: "references/templates/validation-hook-template", freeze_dir: "tests/refs/templates/validation-hook-template"});
check('template parser: standalone ESM parser is present', read(join(ROOT, 'references/templates/validation-hook-template/toml.mjs')).includes('parse'));
check('template parser: license accompanies copied parser', read(join(ROOT, 'references/templates/validation-hook-template/toml.LICENSE')).includes('Redistribution and use in source and binary forms'));
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/validate_plugin.js": 7, "scripts/list_plugins.js": 3, "scripts/register_local.js": 2, "scripts/scaffold_plugin.js": 6, "references/templates/formatting-hook-template/hooks.json": 6, "references/templates/notification-hook-template/hooks.json": 6, "references/templates/validation-hook-template/hooks.json": 6, "references/templates/formatting-hook-template/format.js": 4, "references/templates/notification-hook-template/notify.js": 3, "references/templates/validation-hook-template/validate_template.js": 3, "scripts/check_package_surface.js": 5, "references/package-surface.yaml": 13}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"references/templates/validation-hook-template/toml.LICENSE": 1, "SKILL.md": 50, "SKILL.codex.md": 3, "references/layers.md": 18, "scripts/validate_plugin.js": 7, "scripts/list_plugins.js": 3, "scripts/register_local.js": 2, "scripts/scaffold_plugin.js": 6, "references/agent.md": 6, "references/command.md": 6, "references/hook.md": 11, "references/skill.md": 6, "references/skill-writing-guide.md": 5, "references/skill-testing-guide.md": 6, "references/organizational-guides/agent-architecture.md": 6, "references/organizational-guides/bundle-coherence-guide.md": 6, "references/organizational-guides/command-architecture.md": 6, "references/organizational-guides/hook-architecture.md": 7, "references/organizational-guides/organizational-governance.md": 6, "references/organizational-guides/plugin-design-patterns.md": 6, "references/templates/analyzer-agent-template.md": 5, "references/templates/extractor-agent-template.md": 5, "references/templates/validator-agent-template.md": 5, "references/templates/generator-command-template.md": 4, "references/templates/orchestrator-command-template.md": 4, "references/templates/wizard-command-template.md": 4, "references/templates/formatting-hook-template/README.md": 5, "references/templates/notification-hook-template/README.md": 5, "references/templates/validation-hook-template/README.md": 7, "references/templates/formatting-hook-template/hooks.json": 6, "references/templates/notification-hook-template/hooks.json": 6, "references/templates/validation-hook-template/hooks.json": 6, "references/templates/formatting-hook-template/format.js": 4, "references/templates/notification-hook-template/notify.js": 3, "references/templates/validation-hook-template/validate_template.js": 3, "references/component-decision.md": 6, "references/placement.md": 8, "references/browser-priority.md": 7, "references/deprecated-governance.md": 5, "references/package-surface.yaml": 13, "scripts/check_package_surface.js": 5}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 50, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 317);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
