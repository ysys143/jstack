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

const SENTENCE="E-2 is not mandatory for headers or lists";
const EXEMPT_ROWS=["Header row", "List item", "Itemized body", "Table cell", "Caption row"];
function rule_section(text:any,rid:any):any{
let m:any,nxt:any,rest:any;
(m=search(("(?m)^### "+escapeRegex(rid)+"\\.\\s.*$"), text));
if(truth(!truth(m))) {
return null;
}
(rest=slice(text, (m.index+m[0].length)));
(nxt=search("(?m)^#{2,3}\\s", rest));
return (truth(nxt) ? slice(rest, 0, nxt.index) : rest);
}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function* walk(root:string):Generator<[string,string[],string[]]>{const entries=readdirSync(root,{withFileTypes:true}),dirs=entries.filter(e=>e.isDirectory()).map(e=>e.name);yield[root,dirs,entries.filter(e=>e.isFile()).map(e=>e.name)];for(const dir of dirs)yield*walk(join(root,dir));}
function main(argv:any):any{
let bad:any,doc:any,line:any,root:any,row:any,sect:any,text:any,word:any;
(root=(truth(argv) ? at(argv, 0) : dirname(dirname(resolve(SUITE_FILE)))));
(doc=join(root, "references", "ai-tell-taxonomy.md"));
if(truth(!truth(isfile(doc)))) {
console.log(("[FAIL] Taxonomy missing: " + pyStr(doc)));
return 1;
}
(text=readFileSync(doc,"utf8"));
(bad=[]);
if(truth(((!contains(text, SENTENCE))))) {
bad.push(("Exemption sentence missing: " + pyStr(SENTENCE)));
}
(sect=rule_section(text, "E-2"));
if(truth(((sect === null)))) {
bad.push("E-2 rule section missing");
} else {
if(truth(((!contains(sect, "exemption"))))) {
bad.push("E-2 rule section lacks an exemption clause");
}
for (let word of ["list", "itemized"]) {
if(truth(((!contains(sect, word))))) {
bad.push(("E-2 rule section does not list " + pyStr(word) + " as exempt"));
}
}
if(truth(!truth(search("(?m)^-\\s*적용_서법:\\s*\\S", sect)))) {
bad.push("E-2 rule section lacks an `적용_서법:` line");
}
}
for (let row of EXEMPT_ROWS) {
if(truth(!truth(search(("(?m)^\\|\\s*"+escapeRegex(row)+".*\\|\\s*Exempt\\s*\\|"), text)))) {
bad.push(("Exemption table does not mark " + pyStr(row) + " as exempt"));
}
}
if(truth(!truth(search("(?m)^\\|\\s*Prose paragraph\\s*\\|\\s*Applies\\s*\\|", text)))) {
bad.push("Table does not mark prose paragraphs as subject to the rule; universal exemption removes the rule");
}
for (let line of bad) {
console.log(("[FAIL] E-2 exemption: " + pyStr(line)));
}
if(truth(bad)) {
console.log(("E-2 exemption contract violations: " + pyStr(length(bad))));
return 1;
}
console.log("E-2 exemption contract PASS: exemption sentence, rule clause, and six table rows verified");
return 0;
}
const verdict=main(process.argv.slice(2));
console.log(`${verdict===0?1:0}/1 passed`);
process.exitCode=verdict;
function escapeRegex(text:string):string{return text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
