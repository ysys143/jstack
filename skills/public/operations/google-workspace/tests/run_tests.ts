/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,realpathSync,readdirSync,symlinkSync,rmSync,chmodSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {DOMParser} from '@xmldom/xmldom';
import {homedir,tmpdir} from 'node:os';
import {makeScope,children,localDate,shiftDate} from '../scripts/collection-common.js';
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

const REFS=join(ROOT, "references");
const ENSURE=join(ROOT, "scripts", "ensure_gws.js");
const TOKEN_CHECK=join(ROOT, "scripts", "token_check.js");
const PLUGIN=dirname(dirname(ROOT));
const SOURCE_SETUP_REL="../../hosts/claude/commands/setup-workspace.md";
const BUILT_SETUP_REL="../../commands/setup-workspace.md";
const SETUP_REL=(truth(isfile(join(ROOT, SOURCE_SETUP_REL))) ? SOURCE_SETUP_REL : BUILT_SETUP_REL);
const SETUP=join(ROOT, SETUP_REL);
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}


function next(values:any[],fallback:any=null):any{return values[0]??fallback;}
function compileRegex(pattern:string){return new RegExp(pattern);}

function run_ensure(path:any,home:any):any{
let r:any;
(r=subprocessRun([process.execPath, ENSURE],{capture_output:true,text:true,env:{"PATH": path, "HOME": home}}));
return [r.returncode, r.stdout];
}
const GIT_ENV=({...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null"});
function _git(repo:any,...args:any[]):any{
return subprocessRun(["git", "-C", repo, ...args],{capture_output:true,text:true,env:GIT_ENV});
}
function main():any{
let CG:any,CM:any,MAIL_SH:any,PS:any,REF_CONTRACTS:any,SECRET:any,_:any,_OFF:any,_acct:any,_args:any,_cal:any,_crit_needles:any,_crit_vol:any,_d:any,_only_dirs:any,_parsed:any,_plerr:any,_praw:any,_ps:any,_ps_miss:any,_ps_needles:any,_ps_vol:any,_setup_needles:any,_setup_vol:any,_skill_raw:any,alias:any,alias_script:any,auto:any,b:any,base:any,body:any,c:any,cells:any,cfx:any,crit:any,cron_fields:any,cron_line:any,d:any,d_tomorrow:any,d_yest:any,deep_dir:any,embedded:any,empty:any,ensure_src:any,env:any,err:any,ev:any,f:any,file_base:any,floor:any,flow:any,fn:any,fx:any,got:any,grades:any,gws_bin:any,have:any,i:any,id_re:any,ids:any,install_step:any,json_out:any,json_rc:any,judg:any,k:any,kw:any,kws:any,l:any,label:any,lfx:any,lhome:any,ln:any,m_fn:any,mail_sh:any,mail_sh2:any,missing:any,n:any,name:any,needle:any,nums:any,ok:any,out:any,p:any,passed:any,pat_base:any,pl:any,plain_c:any,r:any,rc:any,rc0:any,rc20:any,rc7:any,rcn:any,rcnp:any,rco:any,rcop:any,ref_rows:any,repo_a:any,row:any,rows:any,sched:any,sched_txt:any,script:any,secret_dir:any,setup:any,skill:any,skill_fm:any,svc:any,t:any,target:any,tbl:any,text:any,tmr:any,today:any,tok_rc:any,tokdir:any,tz:any,v:any,where:any,x:any;
(_skill_raw=read(join(ROOT, "SKILL.md")));
([skill_fm, skill]=split_frontmatter(_skill_raw));
(setup=read(SETUP));
(cells=read(join(REFS, "scrum-cells.md")));
(ids=read(join(REFS, "gdrive-ids.md")));
check("Account separation: CONFIG_DIR contract is documented in SKILL.md", ((contains(skill, "GOOGLE_WORKSPACE_CLI_CONFIG_DIR"))));
check("Account separation: documents the consequence of omitting CONFIG_DIR", ((contains(skill, "personal account, or the reverse"))));
check("Onboarding: scripts must not use shell aliases", ((contains(setup, "Aliases exist only in\ninteractive shells"))));
for (let [label, needle, where, text] of [["SKILL.md verification rule", "reread the target cell's name column", "SKILL.md", skill], ["SKILL.md stop rule", "Stop if it differs", "SKILL.md", skill], ["SKILL.md rationale", "overwritten records are not", "SKILL.md", skill], ["scrum-cells verification rule", "read the name cell again", "scrum-cells", cells], ["scrum-cells quiet-success warning", "silently overwrite another person's cell", "scrum-cells", cells]]) {
check(("Write safety: " + pyStr(label)), ((contains(text, needle))));
}
check("No guessing: measured tab-name calculation failure", ((value:any)=>truth(value)?((contains(cells, "used the fourth week"))):value)(((contains(cells, "calculated fifth-week tab")))));
check("No guessing: row spacing depends on headcount", ((value:any)=>truth(value)?value:((contains(cells, "five-person layout"))))(((contains(cells, "team roster")))));
(rows=findall(("(?m)^\\|[^|]*\\|" + "\\s*\\**(\\d+)\\**\\s*\\|".repeat(5)), cells));
check("No guessing: two weekday rows have five cells (assumed row 4 versus actual row 5)", (compare(length(rows),2,">=")), (pyStr(length(rows)) + " rows"));
check("No guessing: the two row intervals actually differ", ((value:any)=>truth(value)?(!isDeepStrictEqual(at(rows, 0),at(rows, 1))):value)((compare(length(rows),2,">="))), (pyStr((truth(rows) ? at(rows, 0) : "-")) + " vs " + pyStr((truth((compare(length(rows),1,">"))) ? at(rows, 1) : "-"))));
(id_re=compileRegex("`(?:0A|1)[A-Za-z0-9_-]{20,}`"));
check("SSOT: gdrive-ids.md explains local profiles and discovery fields", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(ids, "scrumFolderId"))):value)(((contains(ids, "reportFolderId")))):value)(((contains(ids, "~/.jstack/profiles/<name>/workspace.json")))));
(embedded=Array.from(readdirSync(REFS)).filter((fn: any) => truth(((value:any)=>truth(value)?id_re.test(read(join(REFS, fn))):value)(ends(fn, ".md")))).map((fn: any) => (fn)));
check("SSOT: shared reference does not contain production-shaped IDs", !truth(embedded), pyStr(embedded));
check("SSOT: scrum-cells points to the local ID authority", ((value:any)=>truth(value)?((contains(cells, "authoritative"))):value)(((contains(cells, "~/.jstack/profiles/<name>/workspace.json")))));
check("Tool trap: SKILL.md warns about the namesake tool", ((value:any)=>truth(value)?((contains(skill, "not the other `gws` package"))):value)(((contains(skill, "two conflicting tools named `gws`")))));
(install_step=at(split(at(split(setup, "## Stage 1", 1), -(1)), "## Stage 2", 1), 0));
check("Tool trap: setup step 1 names the correct package", ((contains(install_step, "brew install googleworkspace-cli"))));
check("Tool trap: setup step 1 explicitly rejects the wrong package", ((contains(install_step, "Wrong: this is the git workspace tool"))));
(ensure_src=read(ENSURE));
check("Tool trap: ensure distinguishes the tool through its auth subcommand", ((value:any)=>truth(value)?((contains(ensure_src, "same-name tool"))):value)(((contains(ensure_src, "auth")))));
for (let [label, needle] of [["Test users registration", "Test users"], ["client_secret location", "~/.config/gws-work/"], ["mode 600", "chmod 600"], ["credential repository ban", "Never put `client_secret.json` or tokens in a repository"], ["credential sharing ban", "Do not share credentials"], ["verification command", "auth status"]]) {
check(("Onboarding: " + pyStr(label)), ((contains(setup, needle))));
}
(tbl=search("\\|[^|\\n]*403[^|\\n]*\\|([^|\\n]*)\\|([^|\\n]*)\\|", setup));
check("Onboarding: 403 is paired with this cause/resolution", ((value:any)=>truth(value)?((contains((group(tbl, 1) + group(tbl, 2)), "Test users"))):value)(truth(tbl)), (truth(tbl) ? slice(strip(group(tbl, 1)), 0, 40) : "table row missing"));
check("Onboarding: does not reference a personal local path", ((!contains(setup, "Documents/Github/gws_cli_setup"))));
(_setup_needles=["Test users", "chmod 600", "Never put `client_secret.json` or tokens in a repository", "Do not share credentials", "auth status", "brew install googleworkspace-cli", "Wrong:", "Aliases exist only in"]);
(_setup_vol=content_bytes(setup, _setup_needles));
check("Onboarding: setup-workspace.md volume (>= 2986B)", (compare(_setup_vol,2986,">=")), (pyStr(_setup_vol) + "B"));
const ensureHome=temporaryDirectory(),ensureBin=join(ensureHome,'bin');mkdirSync(ensureBin);const fakeGws=join(ensureBin,'gws');writeFileSync(fakeGws,'#!'+process.execPath+'\nconsole.log(process.argv.includes("--help")?"auth status":"gws fixture");\n');chmodSync(fakeGws,0o755);mkdirSync(join(ensureHome,'.config/gws-fixture'),{recursive:true});writeFileSync(join(ensureHome,'.config/gws-fixture/client_secret.json'),'{}');
try{([rc,out]=run_ensure(ensureBin,ensureHome));check("ensure: Installation + Setup → exit 0",rc===0,`exit=${rc} ${out}`);([rc,out]=run_ensure(ensureBin,join(ensureHome,'missing')));check("ensure: No setting → exit 1",rc===1&&out.includes('authentication'),`exit=${rc} ${out}`);([rc,out]=run_ensure(join(ensureHome,'empty-path'),ensureHome));check("ensure: No installation → exit 2",rc===2,`exit=${rc}`);check("ensure: missing-install guidance names the correct package",out.includes('googleworkspace-cli'));}finally{removeTree(ensureHome);}
(judg=read(join(REFS, "report-judgment.md")));
check("Judgment: commit messages are not treated as facts", ((contains(judg, "A Commit Message Is Not a Verified Fact"))));
(kws=["confirmed", "completed", "agreed", "approved", "deployed", "delivered"]);
(missing=Array.from(kws).filter((k: any) => truth(((!contains(lower(judg), k))))).map((k: any) => (k)));
check("Judgment: all six review keywords are present", !truth(missing), ("missing " + pyStr(missing)));
check("Judgment: SKILL.md contains the same keywords", (Array.from(["확정", "완료", "합의", "승인", "배포", "전달"]).map((k: any) => (((contains(skill, k)))))).every((value:any)=>truth(value)));
check("Judgment: final decision requires user confirmation", ((contains(judg, "user confirmation remains the reliable source"))));
check("Judgment: cell style uses fragments and forbids formal sentence endings", ((value:any)=>truth(value)?((contains(judg, "formal sentence endings"))):value)(((contains(judg, "terse Korean bullet style")))));
check("Judgment: commit count does not equal importance", ((contains(judg, "Commit count does not determine importance"))));
check("Judgment: personal work cannot be identified automatically", ((contains(judg, "Personal work cannot be classified reliably"))));
(ref_rows=findall("`(?:references/)?([a-z][a-z0-9-]+\\.md)`", skill));
check("Separation: reference table has grade columns per row", (compare(length(new Set(ref_rows)),8,">=")), (pyStr(length(new Set(ref_rows))) + " references"));
check("Separation: reference table header declares grade column", ((contains(skill, "tool knowledge, work data, procedures, judgment, and incident handling"))));
(grades=new Set(Array.from(["tool knowledge", "work data", "procedures", "judgment", "incident handling"]).filter((x: any) => truth(((contains(skill, x))))).map((x: any) => (x))));
check("Separation: grade is actually of several types", (compare(length(grades),3,">=")), pyStr(sorted(grades)));
function scope(name:any,{repos='',exclude=''}:any={}):string{const root=temporaryDirectory();try{for(const item of [name,...repos.split(' '),...exclude.split(' ')].filter(Boolean))mkdirSync(join(root,item),{recursive:true});return makeScope(root,repos,exclude)(join(root,name))?'IN':'OUT';}finally{removeTree(root);}}
check("Automatic delivery: whitelist excludes entries outside the list", ((value:any)=>truth(value)?(isDeepStrictEqual(scope("gamma", {repos: "alpha beta"}),"OUT")):value)((isDeepStrictEqual(scope("alpha", {repos: "alpha beta"}),"IN"))), ("alpha=" + pyStr(scope("alpha", {repos: "alpha beta"})) + " gamma=" + pyStr(scope("gamma", {repos: "alpha beta"}))));
check("Automatic delivery: exclusion list actually excludes entries", ((value:any)=>truth(value)?(isDeepStrictEqual(scope("alpha", {exclude: "gamma"}),"IN")):value)((isDeepStrictEqual(scope("gamma", {exclude: "gamma"}),"OUT"))));
check("Automatic delivery: empty include and exclude lists include all by default", (isDeepStrictEqual(scope("anything"),"IN")));
function scope_path(rel:any,{repos='',exclude=''}:any={}):string{const root=temporaryDirectory();try{mkdirSync(join(root,rel),{recursive:true});return makeScope(root,repos,exclude)(join(root,rel))?'IN':'OUT';}finally{removeTree(root);}}
check("Automatic delivery: exclusion list can block a nested repository", ((value:any)=>truth(value)?(isDeepStrictEqual(scope_path("work-a", {exclude: "private"}),"IN")):value)((isDeepStrictEqual(scope_path("work-a/private", {exclude: "private"}),"OUT"))), ("nested=" + pyStr(scope_path("work-a/private", {exclude: "private"}))));
check("Automatic delivery: exclusion wins beneath a whitelisted path", (isDeepStrictEqual(scope_path("work-a/private", {repos: "work-a", exclude: "private"}),"OUT")));
(fx=temporaryDirectory());
try {(secret_dir=join(fx, "work-a", "private-secret"));
(deep_dir=join(secret_dir, "sub"));
mkdirSync(join(secret_dir, ".git"),{recursive:true});
mkdirSync(deep_dir,{recursive:true});
{const f=fileHandle(join(deep_dir, "급여명세.txt"),"w");f.write("x");}
mkdirSync(join(fx, "work-a", ".git"),{recursive:true});
{const f=fileHandle(join(secret_dir, "직접.txt"),"w");f.write("x");}
{const f=fileHandle(join(fx, "work-a", "normal.md"),"w");f.write("x");}
symlinkSync("private-secret", join(fx, "work-a", "harmless"));
(alias=[join(fx,'work-a'),...readdirSync(join(fx,'work-a')).map(name=>join(fx,'work-a',name)).filter(path=>statSync(path).isDirectory())].filter(makeScope(fx,'','private-secret')).map(p=>basename(p)).join(' '));
check("Leak prevention: symlink aliases are blocked using physical paths", ((!contains(alias, "harmless"))), ("loop output = " + pyStr(slice(strip(alias), 0, 60))));
mkdirSync(join(fx, "my repo"),{recursive:true});
{const f=fileHandle(join(fx, "my repo", "sec.txt"),"w");f.write("x");}
function scope_ws(target:any,exclude:any):string{const decoded=exclude.startsWith("$'")?exclude.slice(2,-1).replace(/\\n/g,'\n'):exclude.slice(1,-1);try{return makeScope(fx,'',decoded)(join(fx,target))?'IN':'OUT';}catch{return 'OUT';}}
check("Leak prevention: a single name containing spaces is blocked", (isDeepStrictEqual(scope_ws("my repo", "'my repo'"),"OUT")), scope_ws("my repo", "'my repo'"));
check("Leak prevention: newline-separated multiple entries remain blocked", ((value:any)=>truth(value)?(isDeepStrictEqual(scope_ws("work-a", "$'my repo\\nother'"),"IN")):value)((isDeepStrictEqual(scope_ws("my repo", "$'my repo\\nother'"),"OUT"))), scope_ws("my repo", "$'my repo\\nother'"));
check("Leak prevention: whitespace-mixed list does not silently broaden scope", (isDeepStrictEqual(scope_ws("my repo", "'my repo other'"),"OUT")), scope_ws("my repo", "'my repo other'"));}finally{removeTree(fx, {ignore_errors: true});}
check("Separation: SKILL.md distinguishes evidence grades", ((value:any)=>truth(value)?((contains(skill, "work data"))):value)(((contains(skill, "tool knowledge")))));
check("Separation: explains different refresh cadences", ((contains(skill, "update cycles differ"))));
(REF_CONTRACTS=[["report-judgment.md", "rules for promoting commit intent into reported results", ["A Commit Message Is Not a Verified Fact", "confirmed", "agreed", "Scrum Cell Style", "Ambiguous Projects"], 2671], ["scrum-cells.md", "team-size-dependent row spacing and write safety", ["Never Calculate the Target", "team roster", "Immediately before every write", "sheet ID"], 1846], ["collect-all-projects.md", "two-stage collection supplements Git with mtime", ["collect_git", "collect_by_mtime", "mtime"], 4320], ["draft-first-workflow.md", "draft-first flow leaves a recoverable Markdown record", ["draft", ".md", "recoverable", "Create the Draft"], 3509], ["gws-cli.md", "same-name tool trap and per-account CONFIG_DIR separation", ["googleworkspace-cli", "GOOGLE_WORKSPACE_CLI_CONFIG_DIR", "Multiple Accounts"], 3369], ["report-troubleshooting.md", "observed missing-project, ABORT, and sheet-ID failures", ["An Entire Project Is Missing", "ABORT", "The Monthly Sheet Changed", "clone"], 3759], ["sheets-troubleshooting.md", "CLI surface changes and Hangul-tab parsing traps", ["--spreadsheetId", "Tab Name", "+read", "Parallel Updates"], 3018], ["gdrive-ids.md", "authoritative Drive IDs and replacements for unbundled scripts", ["Drive", "Scripts That Are Not Bundled"], 3116]]);
check_ref_contracts(check, ROOT, REF_CONTRACTS);
check_skill_body(check, ROOT, {needles: ["gws", "tab", "row", "do not treat unknown as pass"], floor: 5374});
check_no_constant_assertions(check, SUITE_FILE);
for (const [file, needles] of [["NOTICE", ["corca-ai/claude-plugins"]], ["LICENSE.corca", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"NOTICE": 1, "LICENSE.corca": 1, "SKILL.md": 22, "references/collect-all-projects.md": 3, "references/draft-first-workflow.md": 3, "references/gdrive-ids.md": 4, "references/gws-cli.md": 3, "references/report-judgment.md": 9, "references/report-troubleshooting.md": 3, "references/scrum-cells.md": 10, "references/sheets-troubleshooting.md": 3, [SETUP_REL]: 11}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 45, extra_strip: ["references/scrum-cells.md", "references/gdrive-ids.md", "references/report-judgment.md"], live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check("SKILL.md: requires token expiry check before writing", ((value:any)=>truth(value)?((contains(skill, "Before writing, check token expiry again"))):value)(((contains(skill, "token_check.js")))));
check("SKILL.md: does not treat indeterminate status as pass", ((contains(skill, "do not treat unknown as pass"))));


(tokdir=temporaryDirectory());
function _mkacct(name:any,files:any):any{
let body:any,d:any,f:any,fn:any;
(d=join(tokdir, name));
mkdirSync(d,{recursive:true});
for (let [fn, body] of Object.entries(files)) {
{const f=fileHandle(join(d, fn),"w");f.write(String(body));}
}
return d;
}
function _iso(minutes:any):string{return new Date(Date.now()+minutes*60000).toISOString().replace(/\.\d{3}Z$/,"Z");}
function run_token(base:any,...extra:any[]):any{
let r:any;
(r=subprocessRun([({executable:process.execPath}).executable, TOKEN_CHECK, "--config-base", base, ...extra],{capture_output:true,text:true}));
return [r.returncode, r.stdout];
}
(SECRET="ya29.SECRET-TOKEN-VALUE");
_mkacct("gws-valid", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(600)})});
_mkacct("gws-expired", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(-(5))})});
_mkacct("gws-soon", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(3)})});
_mkacct("gws-none", {"README": "인증 전 디렉토리"});
_mkacct("gws-enc", {"credentials.enc": "\u0000binary"});
_mkacct("gws-epoch", {"token.json": JSON.stringify({"access_token": SECRET, "expires_at": Math.floor(Date.now()/1000+600*60)})});
_mkacct("gws-epochms", {"token.json": JSON.stringify({"access_token": SECRET, "expiry_date": (Math.floor(Date.now()/1000+600*60) * 1000)})});
function _iso_naive(minutes:any):string{return _iso(minutes).replace(/Z$/," ").trim();}
function _iso_off(minutes:any,hours:any):string{return new Date(Date.now()+minutes*60000+hours*3600000).toISOString().slice(0,19)+(hours>=0?"+":"-")+String(Math.abs(hours)).padStart(2,"0")+":00";}
_mkacct("gws-nofield", {"token.json": JSON.stringify({"access_token": SECRET})});
_mkacct("gws-badjson", {"token.json": (("{\"access_token\": \"" + SECRET) + "\", 깨짐")});
_mkacct("gws-badiso", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": "2026-13-45T99:99:99Z"})});
_mkacct("gws-naive-ok", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso_naive(20)})});
_mkacct("gws-naive-past", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso_naive(-(20))})});
_mkacct("gws-offset-ok", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso_off(20, 9)})});
_mkacct("gws-offset-past", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso_off(-(20), 9)})});
_mkacct("gws-soon7", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(7)})});
_mkacct("gws-ok20", {"token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(20)})});
_mkacct("gws-cred", {"credentials.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(600)})});
_mkacct("gws-oauth", {"oauth_token.json": JSON.stringify({"access_token": SECRET, "expiry": _iso(600)})});
(_only_dirs=[]);
function _only(...names:any[]):any{
let b:any,n:any;

(b=temporaryDirectory());
_only_dirs.push(b);
for (let n of names) {
symlinkSync(join(tokdir, n), join(b, n));
}
return b;
}
function _base({links=[],files=[]}:any={}):any{
let b:any,f:any,name:any,target:any;

(b=temporaryDirectory());
_only_dirs.push(b);
for (let [name, target] of links) {
symlinkSync(join(tokdir, target), join(b, name));
}
for (let name of files) {
{const f=fileHandle(join(b, name),"w");f.write("이것은 디렉토리가 아니다\n");}
}
return b;
}
(empty=temporaryDirectory());
_only_dirs.push(empty);
([rc, out]=run_token(empty));
check("Token: zero accounts is not a pass (exit 2)", ((value:any)=>truth(value)?((contains(out, "[2]"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-valid")));
check("Token: token with sufficient time returns exit 0", ((value:any)=>truth(value)?((contains(out, "[0]"))):value)((isDeepStrictEqual(rc,0))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-expired")));
check("Token: expired token returns exit 1", ((value:any)=>truth(value)?((contains(out, "expired"))):value)((isDeepStrictEqual(rc,1))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-soon")));
check("Token: expiry within the margin returns exit 1", ((value:any)=>truth(value)?((contains(out, "soon"))):value)((isDeepStrictEqual(rc,1))), ("exit=" + pyStr(rc)));
([rc0, _]=run_token(_only("gws-soon"), "--margin", "1"));
check("Token: imminent verdict depends on --margin", (isDeepStrictEqual(rc0,0)), ("exit=" + pyStr(rc0)));
([rc, out]=run_token(_only("gws-none")));
check("Token: missing token file returns unauthenticated exit 1", ((value:any)=>truth(value)?((contains(out, "none"))):value)((isDeepStrictEqual(rc,1))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-enc")));
check("Token: encrypted storage is indeterminate exit 2", ((value:any)=>truth(value)?((contains(out, "unknown"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-expired", "gws-enc")));
check("Token: confirmed expiry (1) takes precedence over indeterminate (2)", (isDeepStrictEqual(rc,1)), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-valid", "gws-epoch", "gws-epochms")));
check("Token: all three valid accounts return exit 0", ((value:any)=>truth(value)?((contains(out, "All 3 accounts"))):value)((isDeepStrictEqual(rc,0))), ("exit=" + pyStr(rc)));
check("Token: reads epoch seconds and milliseconds", (compare(count(out, "ok"),3,">=")), slice(lines(out), 0, 3));
([rc, out]=run_token(_only("gws-valid", "gws-expired", "gws-enc", "gws-none")));
check("Token: output does not leak token values", ((!contains(out, SECRET))), "output contains access_token");
([rc, out]=run_token(_only("gws-nofield")));
check("Token: missing expiry field is indeterminate, not pass (exit 2)", ((value:any)=>truth(value)?((contains(out, "unknown"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-badjson")));
check("Token: malformed JSON does not pass (exit 2)", ((value:any)=>truth(value)?((contains(out, "unknown"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(_only("gws-badiso")));
check("Token: malformed RFC3339 is not treated as valid forever (exit 2)", ((value:any)=>truth(value)?((contains(out, "unknown"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc)));
(json_rc={});
(json_out={});
for (let _acct of ["gws-valid", "gws-expired", "gws-enc"]) {
([json_rc[_acct], json_out[_acct]]=run_token(_only(_acct), "--json"));
}
check("Token: --json preserves exit-code verdicts", (isDeepStrictEqual([at(json_rc, "gws-valid"), at(json_rc, "gws-expired"), at(json_rc, "gws-enc")],[0, 1, 2])), pyStr(json_rc));
function _json_block(txt:any):any{
let i:any,parsedLines:any,ln:any;

(parsedLines=lines(txt));
for (let [i, ln] of enumerate(parsedLines)) {
if(truth((isDeepStrictEqual(rstrip(ln),"]")))) {
try {return JSON.parse(joinText("\n", slice(parsedLines, 0, (i + 1))));}catch(error){return null;}
}
}
return null;
}
(_parsed=Array.from(Object.values(json_out)).map((t: any) => (_json_block(t))));
check("Token: --json output contains verdicts without token values", ((value:any)=>truth(value)?!truth((Array.from(Object.values(json_out)).map((t: any) => (((contains(t, SECRET)))))).some((value:any)=>truth(value))):value)((Array.from(_parsed).map((x: any) => (((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(at(x, 0), "verdict"))):value)(x):value)(isinstance(x, "list"))))).every((value:any)=>truth(value))), slice(pyStr(_parsed), 0, 70));
(pat_base=_base({links: [["gws-valid", "gws-valid"], ["other-expired", "gws-expired"]]}));
([rc, out]=run_token(pat_base));
check("Token: default pattern is gws-*, not *", ((value:any)=>truth(value)?((contains(out, "All 1 accounts"))):value)((isDeepStrictEqual(rc,0))), ("exit=" + pyStr(rc)));
([rc, out]=run_token(pat_base, "--pattern", "other-*"));
check("Token: --pattern actually changes the target", ((value:any)=>truth(value)?((contains(out, "other-expired"))):value)((isDeepStrictEqual(rc,1))), ("exit=" + pyStr(rc)));
(tok_rc=Object.fromEntries(Array.from(["gws-cred", "gws-oauth"]).map((n: any) => ([n, at(run_token(_only(n)), 0)]))));
check("Token: reads credentials.json and oauth_token.json as token files", (isDeepStrictEqual(new Set(Object.values(tok_rc)),new Set([0]))), pyStr(tok_rc));
([rc7, _]=run_token(_only("gws-soon7")));
([rc20, _]=run_token(_only("gws-ok20")));
check("Token: default margin is 10 minutes (7 imminent, 20 safe)", ((value:any)=>truth(value)?(isDeepStrictEqual(rc20,0)):value)((isDeepStrictEqual(rc7,1))), ("7min=" + pyStr(rc7) + " 20min=" + pyStr(rc20)));
([rcn, _]=run_token(_only("gws-naive-ok")));
([rcnp, _]=run_token(_only("gws-naive-past")));
check("Token: timezone-naive expiry is interpreted as UTC", ((value:any)=>truth(value)?(isDeepStrictEqual(rcnp,1)):value)((isDeepStrictEqual(rcn,0))), ("+20min=" + pyStr(rcn) + " -20min=" + pyStr(rcnp)));
([rco, _]=run_token(_only("gws-offset-ok")));
([rcop, _]=run_token(_only("gws-offset-past")));
check("Token: converts offset notation (+09:00) to an instant", ((value:any)=>truth(value)?(isDeepStrictEqual(rcop,1)):value)((isDeepStrictEqual(rco,0))), ("+20min=" + pyStr(rco) + " -20min=" + pyStr(rcop)));
(file_base=_base({links: [["gws-valid", "gws-valid"]], files: ["gws-notadir"]}));
([rc, out]=run_token(file_base));
check("Token: does not count non-directory entries as accounts", ((value:any)=>truth(value)?((contains(out, "All 1 accounts"))):value)((isDeepStrictEqual(rc,0))), ("exit=" + pyStr(rc)));
removeTree(tokdir, {ignore_errors: true});
for (let _d of _only_dirs) {
removeTree(_d, {ignore_errors: true});
}
(CG=read(join(ROOT, "scripts", "collect_git.js")));
check("Collection: collect_git accepts GITHUB_DIR from the environment", ((contains(CG, "githubDirectory"))));
check("Collection: collect_git requires SINCE", ((contains(CG, "Usage:"))), "must print usage and stop without an argument");
check("Collection: collect_git supports author filtering", ((contains(CG, "GIT_COLLECT_AUTHOR"))));
check("Collection: collect_git reports a missing target directory", ((contains(CG, "Collection directory does not exist"))));
(CM=read(join(ROOT, "scripts", "collect_by_mtime.js")));
check("Collection: collect_by_mtime accepts GITHUB_DIR from the environment", ((contains(CM, "githubDirectory"))));
check("Collection: collect_by_mtime accepts the cutoff date", ((contains(CM, "since"))));
check("Collection: both scripts use the same default path", ((value:any)=>truth(value)?((contains(CM, "githubDirectory"))):value)(((contains(CG, "githubDirectory")))));
(cfx=temporaryDirectory());
try {(repo_a=join(cfx, "repo-a"));
(plain_c=join(cfx, "plain-c"));
mkdirSync(repo_a,{recursive:true});
mkdirSync(plain_c,{recursive:true});
{const f=fileHandle(join(repo_a, "a.txt"),"w");f.write("x\n");}
_git(repo_a, "init", "-q");
_git(repo_a, "add", "-A");
_git(repo_a, "commit", "-q", "-m", "내커밋-제목");
{const f=fileHandle(join(repo_a, "b.txt"),"w");f.write("y\n");}
_git(repo_a, "add", "-A");
_git(repo_a, "-c", "user.name=남", "-c", "user.email=other@e", "commit", "-q", "-m", "남의커밋-제목", "--author", "남 <other@e>");
{const f=fileHandle(join(plain_c, "README.md"),"w");f.write("플레인 프로젝트 설명\n둘째 줄\n셋째 줄\n넷째 줄\n");}
{const f=fileHandle(join(plain_c, "새작업.md"),"w");f.write("z\n");}
(today=localDate());
(d_yest=shiftDate(today,-1));
(d_tomorrow=shiftDate(today,1));
function run_cg(...input:any[]):any{
const options=typeof input.at(-1)==='object'?input.pop():{};const args=input;const {github_dir=cfx,author=null}=options;
let env:any,r:any;
(env=({...process.env, GITHUB_DIR: github_dir}));
if(truth(((author === null)))) {
delete env.GIT_COLLECT_AUTHOR;
} else {
(env["GIT_COLLECT_AUTHOR"]=author);
}
(r=subprocessRun([process.execPath, join(ROOT, "scripts", "collect_git.js"), ...args],{capture_output:true,text:true,env:env}));
return [r.returncode, r.stdout, r.stderr];
}
([rc, out, err]=run_cg());
check("Collection runtime: collect_git stops without a cutoff date", ((value:any)=>truth(value)?((contains(err, "Usage:"))):value)((!isDeepStrictEqual(rc,0))), ("exit=" + pyStr(rc) + " " + pyStr(slice(strip(err), 0, 50))));
([rc, out, err]=run_cg(d_yest, {github_dir: join(cfx, "__없다__")}));
check("Collection runtime: missing target directory returns exit 2", ((value:any)=>truth(value)?((contains(err, "Collection directory does not exist"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc)));
([rc, out, err]=run_cg(d_yest));
check("Collection runtime: collects Git commits and skips non-Git directories", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(out, "## plain-c"))):value)(((contains(out, "내커밋-제목")))):value)(((contains(out, "## repo-a")))):value)((isDeepStrictEqual(rc,0))), slice(strip(out), 0, 70));
([rc, out, err]=run_cg(d_yest, {author: "남"}));
check("Collection runtime: author filter retains only matching commits", ((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(out, "내커밋-제목"))):value)(((contains(out, "남의커밋-제목")))):value)((isDeepStrictEqual(rc,0))), slice(strip(out), 0, 70));
([rc, out, err]=run_cg(d_tomorrow,d_tomorrow));
check("Collection runtime: excludes commits before the cutoff date", ((value:any)=>truth(value)?((value:any)=>truth(value)?((!contains(out, "남의커밋-제목"))):value)(((!contains(out, "내커밋-제목")))):value)((isDeepStrictEqual(rc,0))), slice(strip(out), 0, 70));
function run_cm(since:any,github_dir:any=cfx):any{
let r:any;
(r=subprocessRun([process.execPath, join(ROOT, "scripts", "collect_by_mtime.js"), since],{capture_output:true,text:true,env:({...process.env, GITHUB_DIR: github_dir})}));
return [r.returncode, r.stdout];
}
([rc, out]=run_cm(d_yest));
check("Collection runtime: collect_by_mtime supplements non-Git projects", ((value:any)=>truth(value)?((contains(out, "새작업.md"))):value)(((contains(out, "## plain-c")))), slice(strip(out), 0, 70));
check("Collection runtime: collect_by_mtime skips Git repositories", ((!contains(out, "## repo-a"))), slice(strip(out), 0, 70));
check("Collection runtime: collect_by_mtime quotes the README opening", ((contains(out, "> 플레인 프로젝트 설명"))), slice(strip(out), 0, 70));
([rc, out]=run_cm(d_tomorrow));
check("Collection runtime: excludes projects unchanged since the cutoff date", ((value:any)=>truth(value)?((!contains(out, "## repo-a"))):value)(((!contains(out, "## plain-c")))), slice(strip(out), 0, 70));
const defaultEnv:NodeJS.ProcessEnv={...process.env,HOME:'/__no_home__'};delete defaultEnv.GITHUB_DIR;const defaultRun=subprocessRun([process.execPath,join(ROOT,'scripts/collect_git.js'),d_yest],{env:defaultEnv});check("Collection runtime: both scripts share the default GITHUB_DIR",(defaultRun.stdout+defaultRun.stderr).includes('/__no_home__/Documents/GitHub'));
}finally{removeTree(cfx, {ignore_errors: true});}
(_OFF=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/collect_git.js": 10, "scripts/collect_by_mtime.js": 5, "scripts/ensure_gws.js": 4, "scripts/token_check.js": 20}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), _OFF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0), extra_skip: ["스크립트 계약:"]});
check_total(check, results, 144);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
