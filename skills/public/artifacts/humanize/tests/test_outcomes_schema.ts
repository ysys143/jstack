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

const REQUIRED=["run_id", "사업", "결과", "cat"];
const OPTIONAL=["순위"];
const RESULTS=["수주", "탈락", "미정"];
const REJUDGE_AT=10;
const PROVISIONAL="provisional";
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function* walk(root:string):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true}),dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>e.isFile()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}
function main(argv:any):any{
let bad:any,extra:any,field:any,has:any,header:any,i:any,line:any,rows:any,ln:any,path:any,proc:any,ptext:any,r:any,rec:any,records:any,root:any,s:any;
(root=(truth(argv) ? at(argv, 0) : dirname(dirname(resolve(SUITE_FILE)))));
(path=join(root, "outcomes.jsonl"));
(bad=[]);
if(truth(!truth(isfile(path)))) {
console.log(("[FAIL] Field-outcome ledger missing: " + pyStr(path)));
return 1;
}
(rows=lines(readFileSync(path,"utf8")));
(header=joinText("\n", Array.from(rows).filter((ln: any) => truth(starts(ln, "#"))).map((ln: any) => (ln))));
if(truth(!truth(header))) {
bad.push("Missing schema comment header: an empty file differs from zero records");
}
for (let field of [...REQUIRED,...OPTIONAL]) {
if(truth(((!contains(header, field))))) {
bad.push(("Header does not declare field " + pyStr(field)));
}
}
for (let r of RESULTS) {
if(truth(((!contains(header, r))))) {
bad.push(("Header does not declare outcome value " + pyStr(r)));
}
}
(records=[]);
for (let [i, ln] of enumerate(rows).map(([i,row])=>[i+1,row])) {
(s=strip(ln));
if(truth(((value:any)=>truth(value)?value:starts(s, "#"))(!truth(s)))) {
continue;
}
try {(rec=JSON.parse(s));}catch(e){bad.push(("Line " + pyStr(i) + ": JSON parse failed: " + pyStr(e)));
continue;}
if(truth(!truth(isinstance(rec, "dict")))) {
bad.push(("Line " + pyStr(i) + " is not an object"));
continue;
}
records.push(rec);
for (let field of REQUIRED) {
if(truth(((!contains(rec, field))))) {
bad.push(("Line " + pyStr(i) + " lacks required field " + pyStr(field)));
}
}
if(truth(((!contains(RESULTS, (rec["결과"] ?? null)))))) {
bad.push(("Line " + pyStr(i) + ": outcome " + pyStr((rec["결과"] ?? null)) + " is outside " + pyStr(RESULTS)));
}
if(truth(((value:any)=>truth(value)?!truth(isinstance(at(rec, "cat"), "dict")):value)(((contains(rec, "cat")))))) {
bad.push(("Line " + pyStr(i) + ": cat is not an object"));
}
(extra=new Set(Object.keys(rec).filter(key=>![...REQUIRED,...OPTIONAL].includes(key))));
if(truth(extra)) {
bad.push(("Line " + pyStr(i) + ": undeclared fields " + pyStr(sorted(extra))));
}
}
(proc=join(root, "references", "procurement-taxonomy.md"));
if(truth(!truth(isfile(proc)))) {
bad.push("Procurement taxonomy missing: cannot check severity labels");
} else {
(ptext=readFileSync(proc,"utf8"));
(has=((contains(ptext, PROVISIONAL))));
if(truth(((value:any)=>truth(value)?has:value)((compare(length(records),REJUDGE_AT,">="))))) {
bad.push(("At " + pyStr(length(records)) + " records the " + pyStr(PROVISIONAL) + " label remains: reassessment overdue"));
}
if(truth(((value:any)=>truth(value)?!truth(has):value)((compare(length(records),REJUDGE_AT,"<"))))) {
bad.push(("At " + pyStr(length(records)) + " records the " + pyStr(PROVISIONAL) + " label is absent: unsupported finality"));
}
if(truth(((!contains(ptext, pyStr(REJUDGE_AT)))))) {
bad.push(("Procurement taxonomy does not state reassessment threshold " + pyStr(REJUDGE_AT)));
}
}
for (let line of bad) {
console.log(("[FAIL] field outcomes: " + pyStr(line)));
}
if(truth(bad)) {
console.log(("Field-outcome contract violations: " + pyStr(length(bad))));
return 1;
}
console.log(("Field-outcome contract PASS: " + pyStr(length(records)) + " records; header schema and severity labels agree"));
return 0;
}
const verdict=main(process.argv.slice(2));
console.log(`${verdict===0?1:0}/1 passed`);
process.exitCode=verdict;