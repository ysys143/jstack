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

const UPSTREAM=["reports", "technical documents"];
const ADDED=["proposals", "official documents", "itemized writing"];
const SENTENCE="Do not apply 3.9 to proposals, official documents, or itemized writing";
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function* walk(root:string):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true}),dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>e.isFile()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}
function main(argv:any):any{
let bad:any,doc:any,h:any,line:any,listed:any,m:any,nxt:any,rest:any,root:any,sect:any,text:any,w:any;
(root=(truth(argv) ? at(argv, 0) : dirname(dirname(resolve(SUITE_FILE)))));
(doc=join(root, "references", "ai-tell-taxonomy.md"));
if(truth(!truth(isfile(doc)))) {
console.log(("[FAIL] Taxonomy missing: " + pyStr(doc)));
return 1;
}
(text=readFileSync(doc,"utf8"));
(bad=[]);
(h=search("(?m)^### .*3\\.9.*$", text));
if(truth(!truth(h))) {
console.log("[FAIL] 3.9 exceptions: exception section heading missing");
return 1;
}
(rest=slice(text, (h.index+h[0].length)));
(nxt=search("(?m)^#{2,3}\\s", rest));
(sect=(truth(nxt) ? slice(rest, 0, nxt.index) : rest));
(m=search("(?m)^-\\s*Exceptions:\\s*(.+?)\\s*$", sect));
if(truth(!truth(m))) {
bad.push("Exception list line (`- Exceptions:`) missing");
} else {
(listed=group(m, 1));
for (let w of UPSTREAM) {
if(truth(((!contains(listed, w))))) {
bad.push(("Upstream exception " + pyStr(w) + " disappeared; extension must not narrow the list"));
}
}
for (let w of ADDED) {
if(truth(((!contains(listed, w))))) {
bad.push(("Added exception " + pyStr(w) + " missing"));
}
}
}
if(truth(((!contains(sect, SENTENCE))))) {
bad.push(("Exclusion sentence missing: " + pyStr(SENTENCE)));
}
if(truth(((!contains(sect, "qualitative"))))) {
bad.push("Missing statement that qualitative 3.9 cannot be caught mechanically");
}
if(truth(((!contains(sect, "log"))))) {
bad.push("Missing logging duty when a 3.9 false positive lowers a grade");
}
for (let line of bad) {
console.log(("[FAIL] 3.9 exceptions: " + pyStr(line)));
}
if(truth(bad)) {
console.log(("3.9 exception contract violations: " + pyStr(length(bad))));
return 1;
}
console.log("3.9 exception contract PASS: two upstream exceptions, three additions, exclusion sentence, and logging duty");
return 0;
}
const verdict=main(process.argv.slice(2));
console.log(`${verdict===0?1:0}/1 passed`);
process.exitCode=verdict;