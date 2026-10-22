/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const THRESHOLDS=["22 characters", "31 characters", "48 characters"];
const CANON_REL="references/gaejosik.md";
const MIN_SCANNED=20;
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function* walk(root:string):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true}),dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>e.isFile()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}
function main(argv:any):any{
let bad:any,canon:any,copies:any,ctext:any,d:any,dirnames:any,dirpath:any,filenames:any,fp:any,line:any,missing:any,n:any,proc:any,ptext:any,root:any,scanned:any,skills_dir:any,t:any,v:any;
(root=(truth(argv) ? at(argv, 0) : dirname(dirname(resolve(SUITE_FILE)))));
(canon=join(root, "references", "gaejosik.md"));
(bad=[]);
if(truth(!truth(isfile(canon)))) {
console.log(("[FAIL] Canonical fragment-style document missing: " + pyStr(canon)));
return 1;
}
(ctext=readFileSync(canon,"utf8"));
(missing=Array.from(THRESHOLDS).filter((v: any) => truth(((!contains(ctext, v))))).map((v: any) => (v)));
if(truth(missing)) {
bad.push(("Canonical document lacks level thresholds: " + pyStr(missing)));
}
if(truth(((!contains(ctext, "practice"))))) {
bad.push("Canonical document lacks the qualification that thresholds describe practice rather than regulation");
}
if(truth(((!contains(ctext, "Ministry of\nthe Interior and Safety ordinance"))))) {
bad.push("Canonical document lacks the enforcement-rule hierarchy correction (Ministry ordinance)");
}
if(truth(((value:any)=>truth(value)?value:((!contains(ctext, "시행문"))))(((!contains(ctext, "기안문")))))) {
bad.push("Canonical document lacks the 기안문/시행문 scope exclusions");
}
(skills_dir=dirname(root));
([scanned, copies]=[0, []]);
for (let [dirpath, dirnames, filenames] of walk(skills_dir)) {
dirnames.splice(0,dirnames.length,...Array.from(dirnames).filter((d: any) => truth(((!contains(["__pycache__", ".git", "repos"], d))))).map((d: any) => (d)));
for (let n of filenames) {
if(truth(!truth(ends(n, ".md")))) {
continue;
}
(fp=join(dirpath, n));
scanned+=1;
if(truth((isDeepStrictEqual(resolve(fp),resolve(canon))))) {
continue;
}
(t=readFileSync(fp,"utf8"));
if(truth((Array.from(THRESHOLDS).map((v: any) => (((contains(t, v)))))).every((value:any)=>truth(value)))) {
copies.push(relative(skills_dir,fp));
}
}
}
if(truth((compare(scanned,MIN_SCANNED,"<")))) {
bad.push(("Only " + pyStr(scanned) + " documents scanned; population too small for a valid duplicate check"));
}
if(truth(copies)) {
bad.push(("Threshold copies outside the canonical document: " + pyStr(copies) + "; use pointers only"));
}
(proc=join(root, "references", "procurement-taxonomy.md"));
if(truth(!truth(isfile(proc)))) {
bad.push("Procurement taxonomy missing");
} else {
(ptext=readFileSync(proc,"utf8"));
if(truth(((!contains(ptext, CANON_REL))))) {
bad.push(("Procurement taxonomy does not reference " + pyStr(CANON_REL)));
}
if(truth(((!contains(ptext, "itemized"))))) {
bad.push("Procurement taxonomy lacks itemized-style guidance; the pipeline is unaware of it");
}
}
for (let line of bad) {
console.log(("[FAIL] fragment-style ownership: " + pyStr(line)));
}
if(truth(bad)) {
console.log(("Fragment-style ownership contract violations: " + pyStr(length(bad))));
return 1;
}
console.log(("Fragment-style ownership contract PASS: one canonical source, zero copies (" + pyStr(scanned) + " documents checked), procurement pointer verified"));
return 0;
}
const verdict=main(process.argv.slice(2));
console.log(`${verdict===0?1:0}/1 passed`);
process.exitCode=verdict;