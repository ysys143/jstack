import {isMain} from '../../../../../runtime/entry.js';
/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync,lstatSync,copyFileSync,symlinkSync,realpathSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,section,_ref_axes,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>mode.includes('b')?readFileSync(path):readFileSync(path,'utf8')};}

function islink(path:string):boolean{try{return lstatSync(path).isSymbolicLink();}catch{return false;}}
function* walk(root:string,_options:any={}):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true});const dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>!e.isDirectory()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}
function compiled(pattern:string,flags=''){return {findall:(text:string)=>findall((flags.includes('m')?'(?m)':'')+pattern,text)};}

function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const ROW=compiled("^\\|\\s*`([a-z0-9_-]+)`\\s*\\|\\s*`([a-z]+)`\\s*\\|\\s*`(repos/[^`]+/SKILL\\.md)`\\s*\\|\\s*(존치|배제)\\s*\\|\\s*(.+?)\\s*\\|\\s*(.+?)\\s*\\|\\s*$", 'm');
const ENTRY=compiled("^- \\*\\*([a-z0-9_-]+)\\*\\* \\(`([a-z]+)`\\)", 'm');
const IN_TREE=compiled("`([a-z][a-z-]+)`\\(이 저장소\\)");
const DUPLICATES:string[]=["literature-review", "peer-review", "scientific-brainstorming", "scientific-visualization", "scientific-writing"];
const ROSTER_SIZE=16;
const [KEEP_MIN, KEEP_MAX]=[5, 6];
const VERDICTS:Record<string,string>={"experimental-design": "존치", "statistical-power": "존치", "statistical-analysis": "존치", "scientific-critical-thinking": "존치", "hypothesis-generation": "존치", "literature_search_openalex": "존치", "exploratory-data-analysis": "배제", "hypogenic": "배제", "literature-review": "배제", "peer-review": "배제", "scientific-brainstorming": "배제", "scientific-visualization": "배제", "scientific-writing": "배제", "citation-management": "배제", "venue-templates": "배제", "market-research-reports": "배제"};
const REPLACEMENTS:Record<string,string>={"literature-review": "`research`(이 저장소)", "peer-review": "`proposal-review`(플러그인 밖)", "scientific-brainstorming": "`consult`(이 저장소)", "scientific-visualization": "`dataviz`(내장)", "scientific-writing": "`sciwrite`(플러그인 밖)"};
function _read(path:any):any{
let f:any;
{const f=fileHandle(path,"r");return f.read();}
}
const AXES=["tier A: roster table was read", ("tier A: roster has " + pyStr(ROSTER_SIZE) + " rows (15 skills + one literature search)"), "tier A: roster has no duplicate skills", "tier A: source tags exist in _sources.json", "tier A: paths are below their declared source (license attribution)", "tier A: every decided skill has a real SKILL.md", "tier A: analysis-methodology entries were read", "tier A: all 12 analysis-methodology skills are in the roster", ("tier A: kept count is " + pyStr(KEEP_MIN) + "~" + pyStr(KEEP_MAX)), "tier A: decisions match the authoritative list row by row", "tier A: no rows exist outside the authoritative list", "tier A: replacements for five duplicates match the authority", "tier A: summary kept/excluded counts match the table", "tier A: five direct-overlap exclusions match the list", "tier A: budget accounting numbers match the table", "tier A: all five duplicates are excluded", "tier A: every exclusion row has a replacement and reason", "tier A: in-tree replacement skills exist", "tier A: kept statistical-analysis requires the correction document"];
function run(check:any,root:any):any{
let _n:any,_seen:any,_why:any;

(_seen=[]);
function _c(label:any,ok:any,detail:any=""):any{
_seen.push(label);
check(label, ok, detail);
}
try {_run(_c, root);
(_why="execution ended early");}catch(e){(_why=slice(((e instanceof Error?e.name:"Error") + ": " + pyStr(e)), 0, 120));}
for (let _n of AXES) {
if(truth(((!contains(_seen, _n))))) {
check(_n, false, _why);
}
}
}
function _run(check:any,root:any):any{
let _:any,_raw:any,absent:any,alt:any,alt_of:any,bad_alt:any,bad_tag:any,budget:any,dead:any,decl:any,drop:any,dup:any,dupe_row:any,extra:any,flipped:any,keep:any,kept_dup:any,listed:any,listed_dup:any,m:any,meth:any,mis:any,n:any,named:any,names:any,p:any,plugin_root:any,r:any,refs:any,rows:any,s:any,sa:any,src:any,t:any,text:any,thin:any,unjudged:any,v:any,verdict_all:any,verdict_of:any,verdicts_path:any,want:any,why:any;
(refs=join(root, "references"));
(verdicts_path=join(refs, "tier-a-verdicts.md"));
if(truth(!truth(isfile(verdicts_path)))) {
check("tier A: decision document exists", false, "references/tier-a-verdicts.md missing");
return undefined;
}
(text=_read(verdicts_path));
(rows=ROW.findall(text));
check("tier A: roster table was read", (compare(length(rows),15,">=")), (pyStr(length(rows)) + " rows"));
if(truth(!truth(rows))) {
return undefined;
}
check(("tier A: roster has " + pyStr(ROSTER_SIZE) + " rows (15 skills + one literature search)"), (isDeepStrictEqual(length(rows),ROSTER_SIZE)), (pyStr(length(rows)) + " rows"));
(names=Array.from(rows).map((r: any) => (at(r, 0))));
(dup=sorted(new Set(Array.from(names).filter((n: any) => truth((compare(count(names, n),1,">")))).map((n: any) => (n)))));
check("tier A: roster has no duplicate skills", !truth(dup), (pyStr(dup)));
(_raw=strip(_read(join(refs, "_sources.json"))));
(src=(truth(_raw) ? JSON.parse(_raw) : {}));
(bad_tag=sorted(new Set(Array.from(rows).filter(([_skip0, t, _skip1, _skip2, _skip3, _skip4]: any) => truth(((!contains(src, t))))).map(([_skip0, t, _skip1, _skip2, _skip3, _skip4]: any) => (t)))));
check("tier A: source tags exist in _sources.json", !truth(bad_tag), (pyStr(bad_tag)));
(mis=Array.from(rows).filter(([n, t, p, _skip0, _skip1, _skip2]: any) => truth(!truth(starts(p, ("repos/" + pyStr(t) + "/"))))).map(([n, t, p, _skip0, _skip1, _skip2]: any) => ((pyStr(n) + ": " + pyStr(t) + " != " + pyStr(p)))));
check("tier A: paths are below their declared source (license attribution)", !truth(mis), (pyStr(slice(mis, 0, 3))));
(dead=Array.from(rows).filter(([n, _skip0, p, _skip1, _skip2, _skip3]: any) => truth(!truth(isfile(join(root, p))))).map(([n, _skip0, p, _skip1, _skip2, _skip3]: any) => ((pyStr(n) + ": " + pyStr(p)))));
check("tier A: every decided skill has a real SKILL.md", !truth(dead), (pyStr(slice(dead, 0, 3))));
(meth=join(refs, "analysis-methodology.md"));
(listed=(truth(isfile(meth)) ? Array.from(ENTRY.findall(_read(meth))).map(([n, _skip0]: any) => (n)) : []));
check("tier A: analysis-methodology entries were read", (compare(length(listed),10,">=")), (pyStr(length(listed)) + " entries"));
(unjudged=sorted(new Set(listed.filter((name:any)=>!names.includes(name)))));
check("tier A: all 12 analysis-methodology skills are in the roster", ((value:any)=>truth(value)?!truth(unjudged):value)(truth(listed)), ("undecided " + pyStr(unjudged)));
(keep=Array.from(rows).filter((r: any) => truth((isDeepStrictEqual(at(r, 3),"존치")))).map((r: any) => (r)));
(drop=Array.from(rows).filter((r: any) => truth((isDeepStrictEqual(at(r, 3),"배제")))).map((r: any) => (r)));
check(("tier A: kept count is " + pyStr(KEEP_MIN) + "~" + pyStr(KEEP_MAX)), (compare(KEEP_MIN,length(keep),"<=") && compare(length(keep),KEEP_MAX,"<=")), ("kept " + pyStr(length(keep)) + " / excluded " + pyStr(length(drop))));
(verdict_all=Object.fromEntries(Array.from(rows).map(([n, _skip0, _skip1, v, _skip2, _skip3]: any) => ([n, v]))));
(flipped=sorted(Array.from(Object.entries(VERDICTS)).filter(([n, v]: any) => truth((!isDeepStrictEqual((verdict_all[n] ?? null),v)))).map(([n, v]: any) => ((pyStr(n) + ": " + pyStr((verdict_all[n] ?? "없음")) + "!=" + pyStr(v))))));
check("tier A: decisions match the authoritative list row by row", !truth(flipped), (pyStr(slice(flipped, 0, 4))));
(extra=sorted(new Set(Object.keys(verdict_all).filter(name=>!Object.hasOwn(VERDICTS,name)))));
check("tier A: no rows exist outside the authoritative list", !truth(extra), (pyStr(extra)));
(alt_of=Object.fromEntries(Array.from(rows).map(([n, _skip0, _skip1, _skip2, alt, _skip3]: any) => ([n, alt]))));
(bad_alt=sorted(Array.from(Object.entries(REPLACEMENTS)).filter(([n, want]: any) => truth((!isDeepStrictEqual((alt_of[n] ?? null),want)))).map(([n, want]: any) => ((pyStr(n) + ": " + pyStr((alt_of[n] ?? "없음")))))));
check("tier A: replacements for five duplicates match the authority", !truth(bad_alt), (pyStr(slice(bad_alt, 0, 3))));
(decl=search("\\*\\*존치 (\\d+) · 배제 (\\d+)\\.\\*\\*", text));
check("tier A: summary kept/excluded counts match the table", ((value:any)=>truth(value)?(isDeepStrictEqual([Number(group(decl, 1)), Number(group(decl, 2))],[length(keep), length(drop)])):value)(truth(decl)), ("declared " + pyStr((truth(decl) ? decl.slice(1) : "missing")) + " / measured (" + pyStr(length(keep)) + ", " + pyStr(length(drop)) + ")"));
(dupe_row=search("\\|\\s*\\*\\*정면 중복\\*\\*\\s*\\|\\s*(.+?)\\s*\\|", text));
(listed_dup=(truth(dupe_row) ? sorted(findall("`([a-z-]+)`", group(dupe_row, 1))) : []));
check("tier A: five direct-overlap exclusions match the list", (isDeepStrictEqual(listed_dup,sorted(DUPLICATES))), (pyStr(listed_dup)));
(budget=search("tier A (\\d+)종\\s*->\\s*존치 (\\d+)종\\s+(\\d+) 슬롯 반환", text));
check("tier A: budget accounting numbers match the table", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(Number(group(budget, 3)),length(drop))):value)((isDeepStrictEqual(Number(group(budget, 2)),(length(keep) - 1)))):value)((isDeepStrictEqual(Number(group(budget, 1)),(ROSTER_SIZE - 1)))):value)(truth(budget)), (pyStr((truth(budget) ? budget.slice(1) : "block missing")) + " / measured (" + pyStr((ROSTER_SIZE - 1)) + ", " + pyStr((length(keep) - 1)) + ", " + pyStr(length(drop)) + ")"));
(verdict_of=Object.fromEntries(Array.from(rows).map(([n, _skip0, _skip1, v, _skip2, _skip3]: any) => ([n, v]))));
(kept_dup=Array.from(DUPLICATES).filter((n: any) => truth((!isDeepStrictEqual((verdict_of[n] ?? null),"배제")))).map((n: any) => (n)));
check("tier A: all five duplicates are excluded", !truth(kept_dup), ("not excluded " + pyStr(kept_dup)));
(thin=Array.from(drop).filter(([n, _skip0, _skip1, _skip2, alt, why]: any) => truth(((value:any)=>truth(value)?value:((value:any)=>truth(value)?value:(isDeepStrictEqual(alt,"—")))(!truth(alt)))((compare(length(why),10,"<"))))).map(([n, _skip0, _skip1, _skip2, alt, why]: any) => (n)));
check("tier A: every exclusion row has a replacement and reason", !truth(thin), (pyStr(slice(thin, 0, 3))));
(plugin_root=dirname(dirname(root)));
(named=sorted(new Set(Array.from(rows).flatMap(([_name, _tag, _path, _verdict, alt, _reason]: any) => Array.from(IN_TREE.findall(alt)).map((m: any) => (m))))));
(absent=Array.from(named).filter((s: any) => truth(!truth(isdir(join(plugin_root, "skills", s))))).map((s: any) => (s)));
check("tier A: in-tree replacement skills exist", ((value:any)=>truth(value)?!truth(absent):value)(truth(named)), (truth(absent) ? ("missing " + pyStr(absent)) : (pyStr(named))));
(sa=Array.from(rows).filter((r: any) => truth((isDeepStrictEqual(at(r, 0),"statistical-analysis")))).map((r: any) => (r)));
check("tier A: kept statistical-analysis requires the correction document", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(at(at(sa, 0), 5), "stats-corrections.md"))):value)((isDeepStrictEqual(at(at(sa, 0), 3),"존치"))):value)(truth(sa)), (pyStr((truth(sa) ? slice(at(at(sa, 0), 5), 0, 40) : "row missing"))));
}
export {run,DUPLICATES};

if(isMain(import.meta.url)){run(check,ROOT);const passed=results.filter(row=>row[1]).length;console.log(`${passed}/${results.length} passed`);process.exitCode=results.length>0&&passed===results.length?0:1;}
