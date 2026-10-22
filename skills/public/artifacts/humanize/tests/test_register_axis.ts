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

const SERUB=["개조식-무어미", "서술-합쇼체", "캡션-무어미"];
const CASES=5;
const MIN_JUDGE=20;
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function* walk(root:string):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true}),dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>e.isFile()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}
function main(argv:any):any{
let bad:any,blocks:any,body:any,cases:any,doc:any,head:any,i:any,j:any,label:any,line:any,m:any,name:any,num:any,root:any,s:any,seen:any,text:any;
(root=(truth(argv) ? at(argv, 0) : dirname(dirname(resolve(SUITE_FILE)))));
(doc=join(root, "references", "register-axis.md"));
(bad=[]);
if(truth(!truth(isfile(doc)))) {
console.log(("[FAIL] Register-axis document missing: " + pyStr(doc)));
return 1;
}
(text=readFileSync(doc,"utf8"));
if(truth(((!contains(text, "적용_서법:"))))) {
bad.push("Document lacks the `적용_서법:` field contract");
}
for (let name of SERUB) {
if(truth(((!contains(text, name))))) {
bad.push(("Document lacks register name " + pyStr(name)));
}
}
(blocks=regexSplit("(?m)^### Case (\\d+): ",text));
(cases=Array.from(zip(blocks.slice(1).filter((_:any,i:number)=>i%2===0),blocks.slice(2).filter((_:any,i:number)=>i%2===0))));
if(truth((!isDeepStrictEqual(length(cases),CASES)))) {
bad.push(("Found " + pyStr(length(cases)) + " case blocks; expected " + pyStr(CASES)));
}
(seen=new Set());
for (let [num, body] of cases) {
seen.add(num);
(head=(truth(lines(body)) ? strip(at(lines(body), 0)) : ""));
(label=("Case " + pyStr(num) + " (" + pyStr(slice(head, 0, 20)) + ")"));
(m=search("(?m)^-\\s*적용_서법:\\s*(.+?)\\s*$", body));
if(truth(!truth(m))) {
bad.push((pyStr(label) + ": missing `적용_서법:` line"));
} else {
if(truth(!truth((Array.from(SERUB).map((s: any) => (((contains(group(m, 1), s)))))).some((value:any)=>truth(value))))) {
bad.push((pyStr(label) + ": 적용_서법 value " + pyStr(group(m, 1)) + " is not one of the three registers"));
}
}
(j=search("(?m)^-\\s*판정자:\\s*(.+?)\\s*$", body));
if(truth(!truth(j))) {
bad.push((pyStr(label) + ": missing `판정자:` line"));
} else {
if(truth((compare(length(group(j, 1)),MIN_JUDGE,"<")))) {
bad.push((pyStr(label) + ": judge sentence has " + pyStr(length(group(j, 1))) + " characters; fewer than " + pyStr(MIN_JUDGE) + " is insufficient"));
}
}
if(truth(((!contains(body, "Conflict"))))) {
bad.push((pyStr(label) + ": does not state what conflicts"));
}
}
if(truth(((value:any)=>truth(value)?(!isDeepStrictEqual(seen,new Set(Array.from(range(CASES).map(i=>i+1)).map((i: any) => (pyStr(i)))))):value)(cases))) {
bad.push(("Case numbers are not consecutive 1–" + pyStr(CASES) + ": " + pyStr(sorted(seen))));
}
for (let line of bad) {
console.log(("[FAIL] register axis: " + pyStr(line)));
}
if(truth(bad)) {
console.log(("Register-axis contract violations: " + pyStr(length(bad))));
return 1;
}
console.log(("Register-axis contract PASS: " + pyStr(length(cases)) + " cases, all with 적용_서법 and 판정자"));
return 0;
}
const verdict=main(process.argv.slice(2));
console.log(`${verdict===0?1:0}/1 passed`);
process.exitCode=verdict;