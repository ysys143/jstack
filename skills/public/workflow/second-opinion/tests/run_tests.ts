/** Owning behavior and protocol contracts, with measured deletion controls. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync,rmSync,chmodSync} from 'node:fs';
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

const SCRIPTS=join(ROOT, "scripts");
const SKILL_FLOOR=5097;
const FR_FLOOR=1469;
const AC_FLOOR=4163;
const GE_FLOOR=4187;
const SG_FLOOR=4250;

const OWNED_MIN=8;
const L0_TRIGGERS=["2차 의견", "적대적 검증"];
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
return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", body)).filter((r: any) => truth(((!contains(["Ask", "Send", "Instead of"], strip(r)))))).map((r: any) => (r));
}
function mkstub(dirpath:any,name:any,body:any):any{
let f:any,p:any;
(p=join(dirpath, name));
{const f=fileHandle(p,"w");f.write('#!'+process.execPath+'\n'+body);}
chmodSync(p, 493);
return p;
}
function run_script(name:any,args:any,{path,home,extra_env=null,timeout=10,input_text=undefined}:any):any{
let env:any,r:any;

(env={"HOME": home, "PATH": path, "TMPDIR": tmpdir()});
if(truth(extra_env)) {
Object.assign(env,extra_env);
}
(r=subprocessRun([process.execPath, join(SCRIPTS, name), ...args],{capture_output:true,text:true,env:env,timeout:timeout,input:input_text}));
return [r.returncode, r.stdout, r.stderr];
}
const SAFE_PATH="/usr/bin:/bin";
function read_nul_capture(path:string):string[]{return existsSync(path)?readFileSync(path,'utf8').split('\0').filter(Boolean):[];}
function main():any{
let MODE_LEAD:any,P2PATH:any,_:any,_argv2:any,_gb:any,_raw:any,_sent:any,a2:any,ac:any,acap:any,acap2:any,acap3:any,aenv2:any,agy_argv:any,agy_prompt:any,aprompt:any,argv:any,av:any,bad:any,c:any,c2:any,cap:any,ccap:any,ccap2:any,cenv2:any,cin:any,cited:any,codex_argv:any,codex_missing_dir:any,codex_stdin:any,cstdin:any,cstdin2:any,cstubdir:any,d:any,dashn:any,dead:any,err:any,f:any,fm:any,fr:any,g:any,g2:any,g2dir:any,gcap2:any,ge:any,gstub:any,home:any,home2:any,i:any,keyhome:any,ko:any,label:any,lead:any,linked:any,ln:any,log:any,m:any,mb:any,miss_t:any,missing:any,mk_at:any,mode:any,mtd:any,n:any,named:any,o:any,ok:any,orphan:any,others:any,out:any,owned:any,p:any,p2dir:any,pairs:any,passed:any,ph:any,present:any,prompt_val:any,r:any,ran:any,rc:any,ref:any,sb:any,sg:any,skill:any,slines:any,sname:any,sp:any,src:any,st:any,stubdir:any,t:any,tbl:any,tmpls:any,trap_at:any,w:any,want:any,wraplog:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(fr=read(join(ROOT, "references", "framing.md")));
(ac=read(join(ROOT, "references", "ai-council.md")));
(ge=read(join(ROOT, "references", "gemini.md")));
(sg=read(join(ROOT, "references", "synthesis-guide.md")));
check("Request: states that asking whether it looks right invites yes", ((contains(skill, "gets you a yes"))));
check("Request: identifies framing as the cause", ((contains(skill, "The framing does the work"))));
check("Request: identifies finding nothing as the implied reviewer task", ((contains(skill, "finding nothing"))));
check("Request: provides a concrete opposing question", ((contains(skill, "What is wrong with this, and what would prove"))));
check("Request: explains how it makes silence expensive", ((contains(skill, "makes silence expensive"))));
check("Request: treats finding nothing as a claim that must stand", ((contains(skill, "has to stand"))));
(tbl=rows(skill, "## \"Does this look right?\" gets you a yes"));
check("Request: question/response comparison has 4 rows", (isDeepStrictEqual(length(tbl),4)), (pyStr(length(tbl)) + " rows"));
check("Framing: requires withholding the argument", ((contains(skill, "withhold why you believe it works"))));
check("Framing: explains that supplying an argument elicits argument evaluation", ((contains(skill, "evaluates the argument"))));
check("Framing: identifies defects outside the supplied argument", ((contains(skill, "your argument does not cover"))));
check("Framing: requires supplying facts the reviewer cannot obtain", ((contains(skill, "cannot obtain"))));
(sp=rows(fr, "## The split"));
check("Framing: send/withhold comparison has 4 rows", (isDeepStrictEqual(length(sp),4)), (pyStr(length(sp)) + " rows"));
check("Framing: supply inaccessible facts and withhold inferable conclusions", ((value:any)=>truth(value)?((contains(fr, "**inferable**"))):value)(((contains(fr, "**inaccessible**")))));
check("Framing: identifies the conclusion as the test subject", ((contains(fr, "thing being tested"))));
check("Framing: supplying the conclusion replaces the test with argument review", ((contains(fr, "replaces the test with a review"))));
check("Verdict: explicitly denies permission", ((contains(skill, "A verdict is evidence, not permission"))));
check("Verdict: scopes approval to one reviewer and one framing", ((contains(skill, "one reviewer found nothing under one framing"))));
check("Verdict: responsibility does not transfer", ((value:any)=>truth(value)?value:((contains(skill, "does not transfer responsibility"))))(((contains(skill, "does not\ntransfer responsibility")))));
check("Verdict: requires running testable verdicts", ((contains(skill, "rather than filing it"))));
check("Verdict: a disputed rejection is also evidence", ((contains(skill, "also evidence"))));
check("Verdict: the artifact or its presentation is wrong and both are worth fixing", ((value:any)=>truth(value)?value:((contains(skill, "both are worth fixing"))))(((contains(skill, "both are\nworth fixing")))));
check("Independence: reviewers who read one another agree by construction", ((contains(skill, "agree by construction"))));
check("Independence: each reviewer receives no other reviewer output", ((contains(skill, "no access to the others"))));
check("Independence: repeated angles find the same thing more times", ((contains(skill, "finds the same thing more times"))));
check("Independence: supplies examples of distinct angles", ((contains(skill, "what a hostile user does"))));
check("Specificity: requires concrete failures instead of categories", ((value:any)=>truth(value)?value:((contains(fr, "rather than a category"))))(((contains(fr, "rather than a\ncategory")))));
check("Specificity: illustrates why category claims cannot be acted on or dismissed", ((contains(fr, "cannot be acted on or dismissed"))));
check("Specificity: supplies an executable example", ((contains(fr, "with the lock released"))));
check("Specificity: records categories as unverified instead of findings", ((contains(fr, "as unverified rather than as a finding"))));
check("Specificity: explains their different failure modes", ((contains(fr, "a category gets forgotten"))));
check("Model: fluent answers can lack grounds", ((contains(fr, "whether or not it has grounds"))));
check("Model: requires evidence with the verdict", ((value:any)=>truth(value)?value:((contains(fr, "ask for the evidence with the verdict"))))(((contains(fr, "ask\nfor the evidence with the verdict")))));
check("Model: an unsupported verdict is a different object from a weak finding", ((contains(fr, "a different kind of object"))));
check("Model: explains half-fixes caused by treating unsupported verdicts as weak findings", ((contains(fr, "get half-fixed"))));
(ph=rows(fr, "## Phrasings that make refutation the default"));
check("Model: phrasing comparison has 4 rows", (isDeepStrictEqual(length(ph),4)), (pyStr(length(ph)) + " rows"));
check("Model: identifies the shared property of the right-hand alternatives", ((value:any)=>truth(value)?value:((contains(fr, "say so explicitly"))))(((contains(fr, "has to\nsay so explicitly")))));
check("Model: no issue is a claim whereas silence is not", ((contains(fr, "silence is not"))));
check("Restraint: consultation is ceremony if the answer cannot change the path", ((value:any)=>truth(value)?value:((contains(skill, "consultation is ceremony"))))(((contains(skill, "the consultation is\nceremony")))));
check("Restraint: first asks what the answer would change", ((contains(skill, "what the answer would change first"))));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("Boundary: redirect target population is nonempty", (compare(length(named),2,">=")), (pyStr(sorted(named))));
check("Boundary: all redirect targets exist", !truth(missing), ("missing " + pyStr(missing)));
(ko=findall("[가-힣]+", fm));
check("Language: description names the Korean activation intent", ["2차 의견", "적대적 검증"].every(term => fm.includes(term)));
check("Language: includes English triggers", ((value:any)=>truth(value)?((contains(fm, "Triggers:"))):value)(((contains(fm, "proposal")))));
check("L0: description routes independent refutation", ((value:any)=>truth(value)?((contains(fm, "independent"))):value)(((contains(fm, "refute")))));
(miss_t=Array.from(L0_TRIGGERS).filter((t: any) => truth(((!contains(fm, t))))).map((t: any) => (t)));
check("Language: description names the Korean activation intent", ["2차 의견", "적대적 검증"].every(term => fm.includes(term)));
check("L0: description advertises backend names (agy, codex, panel)", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(skill, "panel"))):value)(((contains(skill, "Codex")))):value)(((contains(skill, "`agy`")))));
check("L0: description identifies reviewers as external to internal subagents", ((contains(skill, "external model"))));
check("References: SKILL.md cites gemini.md", ((contains(skill, "references/gemini.md"))));
check("References: SKILL.md cites ai-council.md", ((contains(skill, "references/ai-council.md"))));
check("References: SKILL.md cites synthesis-guide.md", ((contains(skill, "references/synthesis-guide.md"))));
check("References: SKILL.md cites council-bridge.js", ((contains(skill, "scripts/council-bridge.js"))));
check("References: SKILL.md cites check-cli.js", ((contains(skill, "scripts/check-cli.js"))));
check("References: SKILL.md cites parse-output.js", ((contains(skill, "scripts/parse-output.js"))));
check("References: SKILL.md cites framing.md", ((contains(skill, "references/framing.md"))));
check("References: SKILL.md cites gemini-bridge.js within one hop", ((contains(skill, "scripts/gemini-bridge.js"))));
check("References: synthesis-guide.md redirects to framing.md within two hops", ((contains(sg, "references/framing.md"))));
(cited=new Set(findall("`((?:references|scripts)/[A-Za-z0-9._-]+)`", skill)));
(dead=sorted(Array.from(cited).filter((c: any) => truth(!truth(existsSync(join(ROOT, c))))).map((c: any) => (c))));
check("References: all backtick paths in SKILL.md exist (no dead pointers)", ((value:any)=>truth(value)?!truth(dead):value)((compare(length(cited),OWNED_MIN,">="))), (pyStr(length(cited)) + " citations / dead " + pyStr(dead)));
owned=new Set([...readdirSync(join(ROOT,'references')).map(n=>'references/'+n),...readdirSync(join(ROOT,'scripts')).filter(n=>!n.endsWith('.ts')).map(n=>'scripts/'+n)]);orphan=sorted([...owned].filter(n=>!cited.has(n)));
check("References: all references/ and scripts/ files are cited by SKILL.md (no orphans)", ((value:any)=>truth(value)?(compare(length(owned),OWNED_MIN,">=")):value)(!truth(orphan)), ("orphans " + pyStr(orphan) + " / owned " + pyStr(length(owned)) + " files"));
check("Boundary: distinguishes the single backend (agy) from the panel (agy+Codex)", ((contains(skill, "one reviewer, one lens, no panel"))));
check("Boundary: SKILL.md also states the three panel-reading rules", ((contains(skill, "role is not a lens, disagreement is the deliverable a panel"))));
check("Boundary: SKILL.md fixes Codex panel invocation to read-only", ((contains(skill, "--sandbox read-only"))));
check("Boundary: explains redirection to delegate because the panel does not write", ((value:any)=>truth(value)?value:((contains(skill, "Handing Codex an actual write"))))(((contains(skill, "Handing Codex an actual\nwrite")))));
check("Boundary: states that consultation cannot quietly become delegated work", ((contains(skill, "quietly become that"))));
check("Panel document: council-bridge.js invocation uses the exact CLAUDE_PLUGIN_ROOT path", ((contains(ac, "${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/council-bridge.js"))));
check("Panel document: council-bridge.js invocation is executable rather than commented", (Array.from(lines(ac)).filter((ln: any) => truth(((contains(ln, "council-bridge.js"))))).map((ln: any) => (starts(lstrip(ln), "node ")))).some((value:any)=>truth(value)), Array.from(lines(ac)).filter((ln: any) => truth(((contains(ln, "council-bridge.js"))))).map((ln: any) => (ln)));
check("Panel document: forbids hardcoded ~/.claude/plugins paths", ((value:any)=>truth(value)?value:((contains(ac, "do not hardcode a path under `~/.claude/plugins`"))))(((contains(ac, "do not\nhardcode a path under `~/.claude/plugins`")))));
check("Panel document: explains why Codex is fixed to read-only", ((contains(ac, "it never touches a file"))));
check("Panel document: records the previous workspace-write setting and its reason", ((value:any)=>truth(value)?((contains(ac, "read-only"))):value)(((contains(ac, "workspace-write")))));
check("Panel document: redirects to synthesis-guide to distinguish roles from lenses", ((contains(ac, "references/synthesis-guide.md"))));
check("Panel document: does not install missing tools on the caller's behalf", ((value:any)=>truth(value)?value:((contains(ac, "nothing is installed on the caller's behalf"))))(((contains(ac, "nothing is\ninstalled on the caller's behalf")))));
check("Single-backend document: identifies agy as the backend and gemini-cli as deprecated", ((value:any)=>truth(value)?((contains(ge, "deprecated as of 2026-06-18"))):value)(((contains(ge, "successor to `gemini-cli`")))));
check("Single-backend document: gemini-bridge.js invocation uses the exact CLAUDE_PLUGIN_ROOT path", ((contains(ge, "${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/gemini-bridge.js"))));
check("Single-backend document: gemini-bridge.js invocation is executable rather than commented", (Array.from(lines(ge)).filter((ln: any) => truth(((contains(ln, "gemini-bridge.js"))))).map((ln: any) => (starts(lstrip(ln), "node ")))).some((value:any)=>truth(value)), Array.from(lines(ge)).filter((ln: any) => truth(((contains(ln, "gemini-bridge.js"))))).map((ln: any) => (ln)));
check("Single-backend document: model request preserves permission boundary",ge.includes("`--model ID`")&&ge.includes("read-only"));
check("Single-backend document: output-processing step 1 reviews quality", ((contains(ge, "Review the quality first"))));
check("Single-backend document: step 2 leaves adoption to the caller and does not edit files", ((value:any)=>truth(value)?((contains(ge, "changes nothing"))):value)(((contains(ge, "the caller's decision")))));
check("Single-backend document: step 3 reports failures too", ((contains(ge, "failures included"))));
check("Single-backend document: documents the --print/--prompt token-consumption trap", ((contains(ge, "consumes the next token as its value"))));
check("Single-backend document: credentials are inherited without sourcing",ge.includes("process environment")&&ge.includes("not sourced"));
check("Single-backend document: redirects to the panel (ai-council) and synthesis guide", ((value:any)=>truth(value)?((contains(ge, "references/synthesis-guide.md"))):value)(((contains(ge, "references/ai-council.md")))));
check("prism: identifies taking the median as the failure mode", ((contains(sg, "taking the median of the models' opinions"))));
check("prism: includes the role-versus-lens rule", ((contains(sg, "Role ≠ lens"))));
check("prism: includes the disagreement-as-deliverable rule", ((contains(sg, "Disagreement is the deliverable"))));
check("prism: forbids averaging", ((contains(sg, "Never average"))));
check("prism: requires one resolving question per disagreement", ((contains(sg, "the single question that would resolve it"))));
check("prism: explains why the final section is not named Recommendation", ((contains(sg, "not called \"Recommendation.\""))));
check("prism: identifies defaulting to the stricter side as hidden averaging", ((contains(sg, "is itself a hidden"))));
(st=rows(sg, "## The three rules"));
check("prism: three-rule section has no table (three prose items)", (isDeepStrictEqual(st,[])));
check("Rules: prohibits bypassing bridges through direct agy/codex calls", ((contains(skill, "Never invoke `agy` or `codex` directly"))));
check("Rules: explains lost sandbox, flag, and isolation guarantees when bypassed", ((contains(skill, "drops all three at once"))));
check("Rules: native reviewers require authorization",skill.includes("Native reviewers are permitted")&&skill.includes("current session authorize"));
check("Rules: same model is not cross-model evidence",skill.includes("as a different model"));
check("Rules: unavailable reviewer never locks the session",skill.includes("No session-wide tool lock"));
check("Rules: explicit model arguments are supported",skill.includes("`--model ID`")&&skill.includes("`--codex-model ID`"));
check("Rules: obsolete SDK failure cannot prohibit model selection",skill.includes("permanent model prohibition"));
check("Rules: reports exact stderr instead of improvising after bridge failure", ((value:any)=>truth(value)?((contains(skill, "exact stderr"))):value)(((contains(skill, "reported, not improvised around")))));
check("Rules: failure diagnosis points to check-cli.js", ((contains(skill, "scripts/check-cli.js\" agy"))));
check("Rules: unspecified targets use git diff --name-only HEAD for candidates", ((contains(skill, "git diff --name-only HEAD"))));
check("Rules: empty candidates trigger a user question (no whole-repository transmission)", ((value:any)=>truth(value)?((contains(skill, "send the whole repository"))):value)(((contains(skill, "ask the user which files to send")))));
check_skill_body(check, ROOT, {semantic: true, needles: ["gets you a yes", "withhold why you believe it works", "A verdict is evidence, not permission", "agree by construction", "what the answer would change first", "role is not a lens, disagreement is the deliverable a panel", "quietly become that", "reported, not improvised around"], floor: SKILL_FLOOR});
check_ref_contracts(check, ROOT, [["framing.md", "Send/withhold, refutation phrasing, specificity, model reviewers", ["**inaccessible**", "silence is not", "as unverified rather than as a finding", "a different kind of object"], FR_FLOOR], ["ai-council.md", "Panel invocation, read-only rationale, model-flag prohibition, availability, boundaries", ["${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/council-bridge.js", "--sandbox read-only", "it never touches a file", "Council: N/M AIs responded\nsuccessfully.", "Both backends see", "expensive to act on unchecked", "explicit Codex model selection", "installed on the caller's behalf", "Handing Codex a write to actually execute"], AC_FLOOR], ["gemini.md", "Actual backend (agy), invocation, known pitfalls, output processing, boundaries", ["${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/gemini-bridge.js", "successor to `gemini-cli`", "deprecated as of 2026-06-18", "consumes the next token as its value", "Technical specification writing", "`--model ID`", "Review the quality first", "not to referee two"], GE_FLOOR], ["synthesis-guide.md", "Three prism rules, reading procedure, output format, code-review/research synthesis", ["Role ≠ lens", "Disagreement is the deliverable", "Never average", "taking the median of the models' opinions", "the panel's highest-confidence output", "A disputed point with no resolving question", "not automatically weaker", "not called \"Recommendation.\"", "is itself a hidden", "grounds to check it, not grounds to trust it"], SG_FLOOR]], {semantic: ["ai-council.md", "gemini.md"]});
{const home=temporaryDirectory();try{([rc, out, err]=run_script("check-cli.js",["agy"],{path:SAFE_PATH,home:home}));
check("check-cli: missing agy returns rc=1 and its installation command", ((value:any)=>truth(value)?((contains(err, "npm install -g @google/agy"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
([rc, out, err]=run_script("check-cli.js",["codex"],{path:SAFE_PATH,home:home}));
check("check-cli: missing codex returns rc=1 and its installation command", ((value:any)=>truth(value)?((contains(err, "npm install -g @openai/codex"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
([rc, out, err]=run_script("check-cli.js",["gemini"],{path:SAFE_PATH,home:home}));
check("check-cli: gemini deprecation notice directs installation of agy", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(err, "npm install -g @google/agy"))):value)(((contains(err, "deprecated")))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
([rc, out, err]=run_script("check-cli.js",["totally-unknown-cli"],{path:SAFE_PATH,home:home}));
check("check-cli: unknown CLI produces general guidance", ((value:any)=>truth(value)?((contains(err, "No install instructions"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
{const stubdir=temporaryDirectory();try{
mkstub(stubdir, "agy", "process.exitCode=0;");
([rc, out, err]=run_script("check-cli.js",["agy"],{path:(pyStr(stubdir) + ":" + pyStr(SAFE_PATH)),home:home}));
check("check-cli: available agy returns rc=0 without output", ((value:any)=>truth(value)?(isDeepStrictEqual(strip(err),"")):value)((isDeepStrictEqual(rc,0))), ("rc=" + pyStr(rc) + " err=" + pyStr(slice(strip(err), 0, 60))));}finally{removeTree(stubdir);}}
([rc, out, err]=run_script("parse-output.js",["text"],{path:SAFE_PATH,home:home,input_text:"\u001b[31mHELLO\u001b[0m  \n"}));
check("parse-output: text mode strips ANSI and trims surrounding whitespace", (isDeepStrictEqual(out,"HELLO")), pyStr(out));
([rc, out, err]=run_script("parse-output.js",["json-extract"],{path:SAFE_PATH,home:home,input_text:"{\"result\": \"extracted value\"}"}));
check("parse-output: json-extract extracts the result key", (isDeepStrictEqual(strip(out),"extracted value")), pyStr(out));
([rc, out, err]=run_script("parse-output.js",["json-extract"],{path:SAFE_PATH,home:home,input_text:"{\"other\": \"nope\"}"}));
check("parse-output: missing known keys pretty-prints the entire JSON", ((contains(out, "\"other\": \"nope\""))), pyStr(out));
([rc, out, err]=run_script("parse-output.js",["json-extract"],{path:SAFE_PATH,home:home,input_text:"not json at all"}));
check("parse-output: non-JSON falls back to the original with ANSI removed", (isDeepStrictEqual(strip(out),"not json at all")), pyStr(out));
([rc, out, err]=run_script("parse-output.js",[],{path:SAFE_PATH,home:home,input_text:"  raw text  "}));
check("parse-output: omitted arguments default to text", (isDeepStrictEqual(out,"raw text")), pyStr(out));
([rc, out, err]=run_script("gemini-bridge.js",[],{path:SAFE_PATH,home:home}));
check("gemini-bridge: missing --prompt returns rc=1", ((value:any)=>truth(value)?((contains(err, "--prompt is required"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
([rc, out, err]=run_script("gemini-bridge.js",["--prompt", "x", "--bogus", "y"],{path:SAFE_PATH,home:home}));
check("gemini-bridge: unknown flag returns rc=1 and identifies the flag", ((value:any)=>truth(value)?((contains(err, "Unknown option: --bogus"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
([rc, out, err]=run_script("gemini-bridge.js",["--prompt", "x"],{path:SAFE_PATH,home:home}));
check("gemini-bridge: missing agy returns rc=1 and its installation command", ((value:any)=>truth(value)?((contains(err, "npm install -g @google/agy"))):value)((isDeepStrictEqual(rc,1))), slice(strip(err), 0, 80));
// Real CLI entry points under a hostile PATH; agy must never execute.
{const bin=temporaryDirectory();try{
 const trace=join(home,'unauthorized-write');
 mkstub(bin,'agy',"require('node:fs').writeFileSync("+JSON.stringify(trace)+",'BAD');console.log('unsafe');");
 ([rc,out,err]=run_script('gemini-bridge.js',['--prompt','review','--model','literal-model'],{path:bin,home}));
 check('agy: installed backend is refused without a reviewed read-only adapter',rc===1&&err.includes('read-only consultation is unsupported'),err);
 check('agy: refused invocation does not execute the provider',!existsSync(trace),trace);
 ([rc,out,err]=run_script('council-bridge.js',['--prompt','review'],{path:bin,home}));
 check('council: zero successful respondents fails',rc===1&&err.includes('0/1'),err);
 check('council: blocked agy cannot write',!existsSync(trace),out);
 const capture=join(home,'codex-args');
 mkstub(bin,'codex',"require('node:fs').writeFileSync("+JSON.stringify(capture)+",JSON.stringify(process.argv.slice(2)));require('node:fs').readFileSync(0);console.log('CODEX-buffer');");
 ([rc,out,err]=run_script('council-bridge.js',['--prompt','review','--codex-model','literal-model'],{path:bin,home}));
 const args=existsSync(capture)?JSON.parse(readFileSync(capture,'utf8')):[];
 check('council: partial successful results survive',rc===0&&out.includes('CODEX-buffer')&&err.includes('1/2'),out);
 check('council: exact model reaches Codex argv',args[args.indexOf('-m')+1]==='literal-model',args);
 check('council: Codex is read-only',args[args.indexOf('--sandbox')+1]==='read-only',args);
 check('council: no permission bypass',!args.includes('--dangerously-skip-permissions')&&!existsSync(trace),args);
 mkstub(bin,'codex',"process.exitCode=7;");
 ([rc,out,err]=run_script('council-bridge.js',['--prompt','review'],{path:bin,home}));
 check('council: all installed respondents failing is nonzero',rc===1&&err.includes('0/2'),err);
}finally{removeTree(bin);}}
}finally{removeTree(home);}}
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 58, "references/framing.md": 19, "references/ai-council.md": 8, "references/gemini.md": 11, "references/synthesis-guide.md": 11, "scripts/check-cli.js": 13, "scripts/parse-output.js": 10, "scripts/gemini-bridge.js": 5, "scripts/council-bridge.js": 5}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 58, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
(_gb=read(join(ROOT, "scripts", "gemini-bridge.js")));
check('Output: unsupported backend never invokes a model',_gb.includes('No model was invoked'));
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/check-cli.js": 13, "scripts/parse-output.js": 10, "scripts/gemini-bridge.js": 5, "scripts/council-bridge.js": 5}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 155);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
