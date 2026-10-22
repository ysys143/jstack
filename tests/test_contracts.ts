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
function subprocessRun(argv:string[],options:any={}):any{const r=runProcess(argv[0],argv.slice(1),{cwd:options.cwd??ROOT,timeout:120000});return {returncode:r.status,stdout:r.stdout,stderr:r.stderr};}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const CONTRACTS=join(ROOT, "contracts");
const PORTABLE=join(CONTRACTS, "portable-contract.yaml");
const CLAIMS=join(CONTRACTS, "claims.yaml");
const IMPACT=join(CONTRACTS, "change-impact.yaml");
const CHANGELOG=join(ROOT, "CHANGELOG.md");
const README=join(ROOT, "README.md");
const PKG_CHECK=join(ROOT, "skills", "verify", "scripts", "package_check.js");
const FIXTURES=join(ROOT, "skills", "author", "scripts", "tests", "fixtures", "negative");
const AUTHOR_SUITE=join(ROOT, "skills", "author", "tests", "run_tests.js");
const MANIFEST=join(ROOT, ".claude-plugin", "plugin.json");
const VERSION_HEADING=String("^#{1,3}\\s*\\[?v?(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?)\\]?");
const GRADES=["기계", "인간 게이트", "검증불가", "미상"];
const GRADE_FIELD={"기계": "tests", "인간 게이트": "증거", "검증불가": "사유", "미상": "사유"};
const MODES=["fail", "warn"];
const CONTEXTS=["manual", "hook", "post-run"];
const RUNNABLE=[".js", ".mjs", ".ts", ".py", ".sh"];
const BLOCK=[">-", ">", "|", "|-"];
function _rows(text:any):any{
let n:any,out:any,raw:any;

(out=[]);
for (let [n, raw] of lines(text).map((raw:string,i:number)=>[i+1,raw] as [number,string])) {
if(truth(((value:any)=>truth(value)?value:starts(lstrip(raw), "#"))(!truth(strip(raw))))) {
continue;
}
if(truth(((contains(raw, "\t"))))) {
throw new Error(("line " + pyStr(n) + ": tab indentation is rejected"));
}
out.push([(length(raw) - length(lstrip(raw))), strip(raw), n]);
}
return out;
}
function _scalar(s:any):any{
(s=strip(s));
if(truth(((value:any)=>truth(value)?((value:any)=>truth(value)?((contains("\"'", at(s, 0)))):value)((isDeepStrictEqual(at(s, 0),at(s, -(1))))):value)((compare(length(s),2,">="))))) {
return slice(s, 1, -(1));
}
return s;
}
function _flow(s:any):any{
let inner:any,x:any;
(inner=strip(slice(s, 1, -(1))));
return (truth(inner) ? Array.from(split(inner, ",")).filter((x: any) => truth(strip(x))).map((x: any) => (_scalar(x))) : []);
}
function _join(rows:any,i:any,indent:any):any{
let buf:any;

(buf=[]);
while(truth(((value:any)=>truth(value)?(compare(at(at(rows, i), 0),indent,">")):value)((compare(i,length(rows),"<"))))){buf.push(at(at(rows, i), 1));
i+=1;}
return [joinText(" ", buf), i];
}
function _node(rows:any,i:any,indent:any):any{
if(truth(starts(at(at(rows, i), 1), "- "))) {
return _seq(rows, i, indent);
}
return _map(rows, i, indent);
}
function _seq(rows:any,i:any,indent:any):any{
let _:any,head:any,item:any,seq:any,sub:any,val:any;
(seq=[]);
while(truth(((value:any)=>truth(value)?((value:any)=>truth(value)?starts(at(at(rows, i), 1), "- "):value)((isDeepStrictEqual(at(at(rows, i), 0),indent))):value)((compare(i,length(rows),"<"))))){(head=strip(slice(at(at(rows, i), 1), 2)));
if(truth(((contains(BLOCK, head))))) {
i+=1;
([val,i]=_join(rows, i, indent));
seq.push(val);
} else {
if(truth(((value:any)=>truth(value)?ends(head, "]"):value)(starts(head, "[")))) {
seq.push(_flow(head));
i+=1;
} else {
if(truth(((value:any)=>truth(value)?!truth(starts(head, ["\"", "'"])):value)(((contains(head, ":")))))) {
(sub=[[(indent + 2), head, at(at(rows, i), 2)]]);
i+=1;
while(truth(((value:any)=>truth(value)?(compare(at(at(rows, i), 0),indent,">")):value)((compare(i,length(rows),"<"))))){sub.push(at(rows, i));
i+=1;}
([item,_]=_map(sub, 0, (indent + 2)));
seq.push(item);
} else {
seq.push(_scalar(head));
i+=1;
}
}
}}
return [seq, i];
}
function _map(rows:any,i:any,indent:any):any{
let _:any,key:any,line:any,out:any,rest:any;
(out={});
while(truth(((value:any)=>truth(value)?(isDeepStrictEqual(at(at(rows, i), 0),indent)):value)((compare(i,length(rows),"<"))))){(line=at(at(rows, i), 1));
if(truth(starts(line, "- "))) {
break;
}
if(truth(((!contains(line, ":"))))) {
throw new Error(("line " + pyStr(at(at(rows, i), 2)) + ": expected a map — " + pyStr(slice(line, 0, 40))));
}
([key,_,rest]=[line.slice(0,line.indexOf(":")), ":", line.slice(line.indexOf(":")+1)]);
([key,rest]=[strip(key), strip(rest)]);
if(truth(((contains(out, key))))) {
throw new Error(("line " + pyStr(at(at(rows, i), 2)) + ": duplicate key — " + pyStr(key)));
}
if(truth(((contains(BLOCK, rest))))) {
i+=1;
([out[key],i]=_join(rows, i, indent));
} else {
if(truth(((value:any)=>truth(value)?ends(rest, "]"):value)(starts(rest, "[")))) {
(out[key]=_flow(rest));
i+=1;
} else {
if(truth(rest)) {
(out[key]=_scalar(rest));
i+=1;
} else {
i+=1;
if(truth(((value:any)=>truth(value)?(compare(at(at(rows, i), 0),indent,">")):value)((compare(i,length(rows),"<"))))) {
([out[key],i]=_node(rows, i, at(at(rows, i), 0)));
} else {
(out[key]=null);
}
}
}
}}
return [out, i];
}
function parse(text:any):any{
let doc:any,i:any,rows:any;
(rows=_rows(text));
if(truth(!truth(rows))) {
throw new Error("empty document");
}
([doc,i]=_node(rows, 0, at(at(rows, 0), 0)));
if(truth((!isDeepStrictEqual(i,length(rows))))) {
throw new Error(("indentation breaks at line " + pyStr(at(at(rows, i), 2))));
}
return doc;
}
function _script_of(command:any):any{
let tok:any;

for (let tok of split(pyStr(command))) {
if(truth(ends(tok, RUNNABLE))) {
return tok;
}
}
return null;
}
function portable_problems(doc:any):any{
let bad:any,c:any,checks:any,cid:any,ctx:any,field:any,seen:any,v:any;
(bad=[]);
(checks=((value:any)=>truth(value)?value:[])((doc["checks"] ?? null)));
if(truth(!truth(checks))) {
bad.push("checks is empty — a zero-check profile is not a profile");
}
(seen=new Set());
for (let c of checks) {
(cid=((value:any)=>truth(value)?value:"(unnamed)")((c["id"] ?? null)));
for (let field of ["id", "mode", "contexts", "command"]) {
if(truth(!truth((c[field] ?? null)))) {
bad.push((pyStr(cid) + ": missing " + pyStr(field)));
}
}
if(truth(((contains(seen, cid))))) {
bad.push((pyStr(cid) + ": duplicate id"));
}
seen.add(cid);
if(truth(((value:any)=>truth(value)?((!contains(MODES, at(c, "mode")))):value)((c["mode"] ?? null)))) {
bad.push((pyStr(cid) + ": mode outside " + pyStr(MODES) + " — " + pyStr(at(c, "mode"))));
}
(ctx=((value:any)=>truth(value)?value:[])((c["contexts"] ?? null)));
if(truth(((value:any)=>truth(value)?value:!truth(ctx))(!truth(isinstance(ctx, "list"))))) {
bad.push((pyStr(cid) + ": contexts is empty"));
} else {
for (let v of ctx) {
if(truth(((!contains(CONTEXTS, v))))) {
bad.push((pyStr(cid) + ": contexts value " + pyStr(v) + " is not allowed"));
}
}
}
}
return bad;
}
function portable_missing_scripts(doc:any,root:any):any{
let c:any,miss:any,s:any;
(miss=[]);
for (let c of ((value:any)=>truth(value)?value:[])((doc["checks"] ?? null))) {
(s=_script_of((c["command"] ?? "")));
if(truth(((s === null)))) {
miss.push((pyStr((c["id"] ?? null)) + ": command has no executable"));
} else {
if(truth(!truth(existsSync(join(root, s))))) {
miss.push((pyStr((c["id"] ?? null)) + ": " + pyStr(s) + " is absent"));
}
}
}
return miss;
}
function claims_problems(doc:any):any{
let allowed:any,bad:any,c:any,cid:any,claims:any,field:any,g:any,grade:any,schema:any,seen:any;
(bad=[]);
(schema=((value:any)=>truth(value)?value:{})((doc["schema"] ?? null)));
(allowed=((value:any)=>truth(value)?value:[])((schema["검증등급_허용값"] ?? null)));
for (let g of GRADES) {
if(truth(((!contains(allowed, g))))) {
bad.push(("schema: grade " + pyStr(g) + " is undeclared"));
}
}
(claims=((value:any)=>truth(value)?value:[])((doc["claims"] ?? null)));
if(truth(!truth(claims))) {
bad.push("claims is empty");
}
(seen=new Set());
for (let c of claims) {
(cid=((value:any)=>truth(value)?value:"(unnamed)")((c["id"] ?? null)));
if(truth(((contains(seen, cid))))) {
bad.push((pyStr(cid) + ": duplicate id"));
}
seen.add(cid);
for (let field of ["id", "주장", "검증등급", "source_refs"]) {
if(truth(!truth((c[field] ?? null)))) {
bad.push((pyStr(cid) + ": missing " + pyStr(field)));
}
}
(grade=(c["검증등급"] ?? null));
if(truth(((value:any)=>truth(value)?((!contains(GRADES, grade))):value)(grade))) {
bad.push((pyStr(cid) + ": grade " + pyStr(grade) + " is not allowed"));
} else {
if(truth(((value:any)=>truth(value)?!truth((c[at(GRADE_FIELD, grade)] ?? null)):value)(grade))) {
bad.push((pyStr(cid) + ": grade " + pyStr(grade) + " lacks " + pyStr(at(GRADE_FIELD, grade))));
}
}
}
return bad;
}
function claims_binding(doc:any,root:any):any{
let bad:any,c:any,cmd:any,machine:any,path:any,t:any;

([bad,machine]=[[], 0]);
for (let c of ((value:any)=>truth(value)?value:[])((doc["claims"] ?? null))) {
if(truth((!isDeepStrictEqual((c["검증등급"] ?? null),"기계")))) {
continue;
}
machine+=1;
for (let t of ((value:any)=>truth(value)?value:[])((c["tests"] ?? null))) {
([path,cmd]=[(t["path"] ?? null), ((value:any)=>truth(value)?value:"")((t["command"] ?? null))]);
if(truth(!truth(path))) {
bad.push((pyStr((c["id"] ?? null)) + ": tests has no path"));
continue;
}
if(truth(!truth(existsSync(join(root, path))))) {
bad.push((pyStr((c["id"] ?? null)) + ": " + pyStr(path) + " is absent"));
}
if(truth(((!contains(cmd, path))))) {
bad.push((pyStr((c["id"] ?? null)) + ": command does not invoke " + pyStr(path)));
}
}
}
return [bad, machine];
}
function claims_sources(doc:any,root:any):any{
let bad:any,c:any,f:any,full:any,ref:any,sel:any;
(bad=[]);
for (let c of ((value:any)=>truth(value)?value:[])((doc["claims"] ?? null))) {
for (let ref of ((value:any)=>truth(value)?value:[])((c["source_refs"] ?? null))) {
([f,sel]=[(ref["file"] ?? null), (ref["selector"] ?? null)]);
(full=join(root, ((value:any)=>truth(value)?value:"")(f)));
if(truth(((value:any)=>truth(value)?value:!truth(isfile(full)))(!truth(f)))) {
bad.push((pyStr((c["id"] ?? null)) + ": source " + pyStr(f) + " is absent"));
continue;
}
if(truth(!truth(sel))) {
bad.push((pyStr((c["id"] ?? null)) + ": " + pyStr(f) + " has no selector"));
} else {
if(truth(((!contains(read(full), sel))))) {
bad.push((pyStr((c["id"] ?? null)) + ": " + pyStr(f) + " lacks selector `" + pyStr(sel) + "`"));
}
}
}
}
return bad;
}
function impact_problems(doc:any):any{
let bad:any,field:any,r:any,rid:any,rules:any,seen:any;
(bad=[]);
(rules=((value:any)=>truth(value)?value:[])((doc["rules"] ?? null)));
if(truth(!truth(rules))) {
bad.push("rules is empty");
}
(seen=new Set());
for (let r of rules) {
(rid=((value:any)=>truth(value)?value:"(unnamed)")((r["id"] ?? null)));
if(truth(((contains(seen, rid))))) {
bad.push((pyStr(rid) + ": duplicate id"));
}
seen.add(rid);
for (let field of ["id", "when_changed", "require_all_changed", "verify"]) {
if(truth(!truth((r[field] ?? null)))) {
bad.push((pyStr(rid) + ": missing " + pyStr(field)));
}
}
}
return bad;
}
function impact_requires_runnables(doc:any):any{
let bad:any,p:any,r:any;

(bad=[]);
for (let r of ((value:any)=>truth(value)?value:[])((doc["rules"] ?? null))) {
for (let p of ((value:any)=>truth(value)?value:[])((r["require_all_changed"] ?? null))) {
if(truth(!truth(ends(pyStr(p), RUNNABLE)))) {
bad.push((pyStr((r["id"] ?? null)) + ": " + pyStr(p) + " is not an executable verifier"));
}
}
}
return bad;
}
function impact_paths(doc:any,root:any):any{
let bad:any,p:any,r:any,s:any;
(bad=[]);
for (let r of ((value:any)=>truth(value)?value:[])((doc["rules"] ?? null))) {
for (let p of ((value:any)=>truth(value)?value:[])((r["require_all_changed"] ?? null))) {
if(truth(!truth(existsSync(join(root, p))))) {
bad.push((pyStr((r["id"] ?? null)) + ": required path " + pyStr(p) + " is absent"));
}
}
for (let p of ((value:any)=>truth(value)?value:[])((r["when_changed"] ?? null))) {
if(truth(!truth(existsSync(join(root, p))))) {
bad.push((pyStr((r["id"] ?? null)) + ": when_changed path " + pyStr(p) + " is absent"));
}
}
(s=_script_of((r["verify"] ?? "")));
if(truth(((s === null)))) {
bad.push((pyStr((r["id"] ?? null)) + ": verify has no executable"));
} else {
if(truth(!truth(existsSync(join(root, s))))) {
bad.push((pyStr((r["id"] ?? null)) + ": verify " + pyStr(s) + " is absent"));
}
}
}
return bad;
}
function table_rows(text:any):any{
let c:any,cells:any,line:any,rows:any,s:any;

(rows=[]);
for (let line of lines(text)) {
(s=strip(line));
if(truth(((value:any)=>truth(value)?value:!truth(ends(s, "|")))(!truth(starts(s, "|"))))) {
continue;
}
(cells=Array.from(split(slice(s, 1, -(1)), "|")).map((c: any) => (strip(c))));
if(truth((Array.from(cells).map((c: any) => (((value:any)=>truth(value)?c:value)((compare(new Set(c),new Set("-: "),"<=")))))).every((value:any)=>truth(value)))) {
continue;
}
rows.push(cells);
}
return rows;
}
function main():any{
let _:any,absent:any,au:any,bind:any,c:any,cb:any,cdoc:any,cl:any,cs:any,d:any,declared:any,docs:any,empty:any,err:any,fx:any,graded:any,hooked:any,ib:any,idoc:any,ip:any,ir:any,label:any,line:any,m:any,machine:any,mg:any,n:any,name:any,ok:any,passed:any,path:any,pb:any,pdoc:any,pm:any,r:any,removed:any,rows:any,sec:any,selfref:any,tab_rejected:any,top:any,x:any;
for (let [label, path] of [["portable-contract.yaml", PORTABLE], ["claims.yaml", CLAIMS], ["change-impact.yaml", IMPACT], ["CHANGELOG.md", CHANGELOG], ["README.md", README]]) {
check(("File: " + pyStr(label) + " exists"), isfile(path), path);
}
(docs={});
for (let [label, path] of [["portable", PORTABLE], ["claims", CLAIMS], ["impact", IMPACT]]) {
try {(docs[label]=parse(read(path)));
(err="");}catch(e){(docs[label]={});
(err=pyStr(e));}
check(("Format: " + pyStr(label) + " parses as restricted YAML"), !truth(err), slice(err, 0, 100));
}
([pdoc,cdoc,idoc]=[at(docs, "portable"), at(docs, "claims"), at(docs, "impact")]);
check("portable: profile name is portable", (isDeepStrictEqual((pdoc["profile"] ?? null),"portable")), pyStr((pdoc["profile"] ?? null)));
(pb=portable_problems(pdoc));
check("portable: every check has id, mode, contexts, and command", !truth(pb), slice(joinText("; ", pb), 0, 160));
(pm=portable_missing_scripts(pdoc, ROOT));
check("portable: every command executable exists", !truth(pm), slice(joinText("; ", pm), 0, 160));
(hooked=Array.from(((value:any)=>truth(value)?value:[])((pdoc["checks"] ?? null))).filter((c: any) => truth(((contains(((value:any)=>truth(value)?value:[])((c["contexts"] ?? null)), "hook"))))).map((c: any) => (c)));
check("portable: at least one check has hook context", (compare(length(hooked),1,">=")), (pyStr(length(hooked)) + " items"));
(cb=claims_problems(cdoc));
check("claims: grade-specific required fields are respected", !truth(cb), slice(joinText("; ", cb), 0, 200));
([bind,machine]=claims_binding(cdoc, ROOT));
check("claims: machine-grade tests exist and commands invoke them", !truth(bind), slice(joinText("; ", bind), 0, 200));
check("claims: at least one machine-grade claim exists — total exemption is not exemption", (compare(machine,1,">=")), (pyStr(machine) + " items"));
(cs=claims_sources(cdoc, ROOT));
check("claims: source files exist and contain their selectors", !truth(cs), slice(joinText("; ", cs), 0, 200));
const verifierClaim=(cdoc.claims??[]).find((claim:any)=>claim.id==='verifier-takes-no-executor-rationale');
check("claims: verifier input claim binds its independence boundary", verifierClaim?.source_refs?.some((ref:any)=>ref.file==='agents/quality-verifier.md'&&ref.selector==="Do not receive the executor's")===true);
(graded=Array.from(((value:any)=>truth(value)?value:[])((cdoc["claims"] ?? null))).filter((c: any) => truth(((contains(["검증불가", "미상"], (c["검증등급"] ?? null)))))).map((c: any) => (c)));
check("claims: at least one unmeasurable claim is marked as such", (compare(length(graded),1,">=")), (pyStr(length(graded)) + " items"));
(ib=impact_problems(idoc));
check("impact: every rule has id, when_changed, require_all_changed, and verify", !truth(ib), slice(joinText("; ", ib), 0, 200));
(ir=impact_requires_runnables(idoc));
check("impact: required items are executable verifiers, not documents", !truth(ir), slice(joinText("; ", ir), 0, 200));
(ip=impact_paths(idoc, ROOT));
check("impact: all when_changed, require, and verify paths exist", !truth(ip), slice(joinText("; ", ip), 0, 200));
(selfref=Array.from(((value:any)=>truth(value)?value:[])((idoc["rules"] ?? null))).filter((r: any) => truth(((contains(((value:any)=>truth(value)?value:[])((r["when_changed"] ?? null)), "contracts/claims.yaml"))))).map((r: any) => (r)));
check("impact: changes to the contract files trigger a rule", (compare(length(selfref),1,">=")), (pyStr(length(selfref)) + " items"));
(r=subprocessRun([({executable:process.execPath}).executable, PKG_CHECK, ROOT],{capture_output:true,text:true}));
check("CHANGELOG: package_check returns 0 (top-level <-> plugin.json)", (isDeepStrictEqual(r.returncode,0)), (truth(strip((r.stdout + r.stderr))) ? slice(at(lines(strip((r.stdout + r.stderr))), -(1)), 0, 120) : ("rc=" + pyStr(r.returncode))));
(cl=(truth(isfile(CHANGELOG)) ? read(CHANGELOG) : ""));
(top=null);
for (let line of lines(cl)) {
if(truth(match("(?s)"+"^#{1,3}\\s*\\[?Unreleased\\]?",line))) {
continue;
}
(m=match(VERSION_HEADING,line));
if(truth(m)) {
(top=group(m, 1));
break;
}
}
(declared=(truth(isfile(MANIFEST)) ? at(JSON.parse(read(MANIFEST)), "version") : null));
check("CHANGELOG: top version equals plugin.json version", ((value:any)=>truth(value)?(isDeepStrictEqual(top,declared)):value)(((top !== null))), (pyStr(top) + " vs " + pyStr(declared)));
for (let sec of ["## [Unreleased]", "### Added"]) {
check(("CHANGELOG: `" + pyStr(sec) + "` section exists"), ((contains(cl, sec))));
}
check("Fixtures: canonical negative-fixture directory exists", isdir(FIXTURES), FIXTURES);
(fx=(truth(isdir(FIXTURES)) ? sorted(readdirSync(FIXTURES)) : []));
check("Fixtures: at least 10 cases exist", (compare(length(fx),10,">=")), (pyStr(length(fx))));
(empty=Array.from(fx).filter((n: any) => truth(!truth(readdirSync(join(FIXTURES, n))))).map((n: any) => (n)));
check("Fixtures: no case is empty — empty fixtures always pass", !truth(empty), pyStr(slice(empty, 0, 3)));
(au=(truth(isfile(AUTHOR_SUITE)) ? read(AUTHOR_SUITE) : ""));
check("Fixtures: author suite actually runs those fixtures", ((value:any)=>truth(value)?((contains(au, "fixtures"))):value)(((contains(au, "run_fixtures.js")))));
check("Fixtures: author negative cases have no copies under root tests/", ((value:any)=>truth(value)?!truth((Array.from(fx).map((name: any) => (existsSync(join(HERE, "fixtures", name))))).some((value:any)=>truth(value))):value)(!truth(existsSync(join(HERE, "fixtures", "negative")))), "canonical path is skills/author/scripts/tests/fixtures/negative");
function drop(doc:any,seq_key:any,field:any):any{
let d:any;

(d=structuredClone(doc));
if(truth((d[seq_key] ?? null))) {
delete d[seq_key][0][field];
}
return d;
}
check("Self-check (RED): deleting portable mode is caught", truth(portable_problems(drop(pdoc, "checks", "mode"))));
check("Self-check (RED): deleting machine-grade claims tests is caught", truth(claims_problems(drop(cdoc, "claims", "tests"))));
check("Self-check (RED): requiring .md in change-impact is caught", truth(impact_requires_runnables({"rules": [{"id": "x", "require_all_changed": ["NOTICE.md"]}]})));
(absent=join("tests", (("absent-" + "fixture") + ".js")));
check("Self-check (RED): a missing test path is caught", truth(at(claims_binding({"claims": [{"id": "x", "검증등급": "기계", "tests": [{"path": absent, "command": ("node " + absent)}]}]}, ROOT), 0)));
(tab_rejected=false);
try {parse("a:\n\tb: 1\n");}catch(error){(tab_rejected=true);}
check("Self-check (RED): parser rejects tab indentation", tab_rejected);
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 38);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
