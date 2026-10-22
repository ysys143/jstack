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
const WANT=["ai-tell-detector", "content-fidelity-auditor", "korean-ai-tell-taxonomist", "korean-procurement-detector", "korean-procurement-fidelity-auditor", "korean-procurement-naturalness-reviewer", "korean-procurement-rewriter", "korean-style-rewriter", "naturalness-reviewer"];
function main():any{
let _:any,all_names:any,b:any,bare:any,body:any,f:any,fm:any,missing:any,n:any,names:any,ok:any,passed:any,r:any,raw:any,refs:any;
(all_names=sorted(Array.from(readdirSync(AG)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (slice(f, 0, -(3))))));
check("Inventory: the unified agent count is 17", (isDeepStrictEqual(length(all_names),17)), (pyStr(length(all_names))));
(names=sorted(WANT));
for (let n of names) {
(raw=read(join(AG, (n + ".md"))));
([fm,body]=split_frontmatter(raw));
check(("Format: " + pyStr(n) + " name matches its filename"), truth(search(("(?m)^name:\\s*" + pyStr(escapeRegex(n)) + "\\s*$"), fm)));
check(("Format: " + pyStr(n) + " has a description"), truth(search("(?m)^description:\\s*\\S", fm)));
check(("Body: " + pyStr(n) + " contains procedure or judgment"), (compare(length(strip(body)),400,">")), (pyStr(length(strip(body))) + "B"));
(refs=new Set(findall("\\$\\{CLAUDE_PLUGIN_ROOT\\}/([A-Za-z0-9_./-]+\\.[a-z]+)", raw)));
(missing=sorted(Array.from(refs).filter((r: any) => truth(!truth(existsSync(join(ROOT, r))))).map((r: any) => (r))));
check(("References: all plugin paths named by " + pyStr(n) + " exist"), !truth(missing), ("missing " + pyStr(missing)));
(bare=new Set(findall("(?<![-A-Za-z0-9_/])([a-z][a-z0-9_-]*\\.md)(?![A-Za-z0-9_/])", raw)));
bare=new Set([...bare].filter((name:string)=>![...refs].some((ref:string)=>basename(ref)===name)));
(bare=new Set(Array.from(bare).filter((b: any) => truth((!isDeepStrictEqual(b,(n + ".md"))))).map((b: any) => (b))));
check(("References: " + pyStr(n) + " has no pathless filename citations"), !truth(bare), (pyStr(sorted(bare))));
}
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 48);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
