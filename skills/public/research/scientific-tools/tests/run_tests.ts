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

function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const REFS=join(ROOT, "references");
const moduleRoster=await import(new URL('./test_tier_a_roster.js',import.meta.url).href);
const moduleGenerator=await import(new URL('../scripts/rebuild-index.js',import.meta.url).href);
const REPOS=join(ROOT, "repos");
const REF_BYTES={"_kdense-catalog.md": 108185, "academic-paper-pipeline.md": 710, "agent-frameworks.md": 304, "analysis-methodology.md": 2170, "autonomous-research-optimization-frameworks.md": 371, "bioinformatics-genomics.md": 3208, "biological-databases-deepmind.md": 6051, "cheminformatics-drug-discovery.md": 1277, "clinical-documentation-decision-support.md": 736, "cloud-platforms-for-genomics-biomedical-data.md": 398, "data-analysis-visualization.md": 1400, "data-management-infrastructure.md": 645, "decision-scenario-analysis.md": 662, "document-processing-conversion.md": 629, "electronic-lab-notebooks-eln.md": 523, "engineering-simulation.md": 1066, "healthcare-ai-clinical-machine-learning.md": 377, "laboratory-automation-equipment-control.md": 379, "laboratory-automation.md": 544, "laboratory-information-management-systems-lims-r-d-platforms.md": 418, "machine-learning-deep-learning.md": 2531, "materials-science-chemistry.md": 609, "medical-imaging-digital-pathology.md": 751, "microscopy-bio-image-data.md": 377, "neuroscience-electrophysiology.md": 658, "pharmacology-pharmacometrics.md": 374, "phylogenetics-evolutionary-biology.md": 532, "preclinical-research-animal-welfare.md": 400, "protein-engineering-design.md": 893, "proteomics-mass-spectrometry.md": 423, "protocol-management-sharing.md": 390, "regulatory-standards-evidence-preparation.md": 592, "research-methodology-proposal-writing.md": 1114, "scientific-communication-publishing.md": 1877, "scientific-databases-data-access.md": 1562, "tool-discovery-computational-resources.md": 552, "uncategorized.md": 354, "web-search-information-retrieval.md": 491, "workflow-platforms-cloud-execution.md": 647};
const OWN_REFS={"stats-corrections.md": [["**Always default to Welch without a pretest.**", "MWU's null is `P(X > Y) = P(Y > X)`, not equality of medians.", "Tukey HSD **already controls familywise error (FWER)** through the studentized range distribution and needs no preliminary gate."], 6524], "tier-a-verdicts.md": [["**The tier A roster lists skill names, and each name directly consumes the top-level budget.**", "**That description is true for five and false for seven.**", "**존치 6 · 배제 10.**"], 6380], "reproducibility.md": [["**None of the 159 imported skills is dedicated to reproducibility.**", "These pins are a dated direct-dependency snapshot, not a transitive lockfile.", "**Direct dependency pins do not establish reproducibility.**"], 4643]};
const NOTICE_FLOOR=1628;
const STATS_SUMMARY=[["Two-group mean comparison", "Welch only after significant Levene", "**Always Welch**"], ["Three or more groups", "ANOVA, then Welch ANOVA if equal variance is violated", "**Always Welch ANOVA**"], ["Nonparametric two-group comparison", "MWU followed by median reporting", "**Stochastic superiority + rank-biserial**"], ["Post-hoc pairwise comparisons", "omnibus p < .05 gate", "**Tukey HSD without a gate**"], ["Bayesian two-group comparison", "Shared sigma, normal likelihood", "**Group-specific sigma, StudentT (BEST)**"]];
const STATS_VERDICTS=["**Always default to Welch without a pretest.**", "**Describe stochastic superiority.**", "**Delete the gate.**", "**Use BEST as the default example.**"];
const REPRO_LOCK=[["**Required**", "One of `uv.lock`, `poetry.lock`, or `requirements.txt --require-hashes`", "Must pin hashes as well"], ["**Required**", "Python interpreter version (`.python-version` or a declaration in the lockfile)", "The pinned-version table already requires 3.12+"], ["Recommended", "Container image digest (`sha256:`, not a tag)", "Tags can move"], ["Recommended", "OS, CPU architecture, and BLAS implementation", "These can affect floating-point results"]];
function table_rows(text:any,head:any):any{
let body:any,c:any,cells:any,line:any,out:any,s:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
(out=[]);
for (let line of lines(body)) {
(s=strip(line));
if(truth(((value:any)=>truth(value)?value:(compare(new Set(s),new Set("|-: "),"<=")))(!truth(starts(s, "|"))))) {
continue;
}
(cells=Array.from(split(strip(s, "|"), "|")).map((c: any) => (strip(c))));
out.push(cells);
}
return (truth(out) ? slice(out, 1) : out);
}
function check_stats_direction(check:any):any{
let auto:any,c:any,cell:any,decl:any,fp:any,got:any,heads:any,i:any,ln:any,n:any,proofs:any,r:any,rows:any,t:any,undated:any,verdicts:any;

(fp=join(REFS, "stats-corrections.md"));
if(truth(!truth(isfile(fp)))) {
check("Correction direction: stats-corrections.md exists", false, "file missing");
return undefined;
}
(t=read(fp));
(heads=findall("(?m)^## Correction (\\d+):", t));
check("Correction direction: four blocks are numbered 1 through 4", (isDeepStrictEqual(heads,["1", "2", "3", "4"])), (pyStr(heads)));
(decl=search("Corrections to (\\d+) upstream `statistical-analysis` recommendations", t));
check("Correction direction: title count matches block count", ((value:any)=>truth(value)?(isDeepStrictEqual(Number(group(decl, 1)),length(heads))):value)(truth(decl)), ("declared " + pyStr((truth(decl) ? group(decl, 1) : "missing")) + " / blocks " + pyStr(length(heads))));
for (let cell of ["Upstream instruction", "Error", "Evidence", "Local action"]) {
(n=length(findall((("\\| \\*\\*" + cell) + "\\*\\* \\|"), t)));
check(("Correction direction: field '" + pyStr(cell) + "' appears in every block"), (isDeepStrictEqual(n,length(heads))), (pyStr(n) + " fields / " + pyStr(length(heads)) + " blocks"));
}
(proofs=findall("\\| \\*\\*Evidence\\*\\* \\| (.+?) \\|\\n", (t + "\n")));
(undated=Array.from(enumerate(proofs)).filter(([i, c]: any) => truth(!truth(search("\\(\\d{4}[,)]", c)))).map(([i, c]: any) => ((i + 1))));
check("Correction direction: every evidence field cites a dated source", ((value:any)=>truth(value)?!truth(undated):value)((isDeepStrictEqual(length(proofs),length(heads)))), ("missing year " + pyStr(undated)));
(verdicts=findall("\\| \\*\\*Local action\\*\\* \\| (\\*\\*[^*]+\\*\\*)", t));
check("Correction direction: four local actions match canonical sentences", (isDeepStrictEqual(Array.from(verdicts),STATS_VERDICTS)), (pyStr(verdicts)));
(rows=Array.from(table_rows(t, "## Application summary")).filter((r: any) => truth((isDeepStrictEqual(length(r),3)))).map((r: any) => (r)));
(got=Array.from(rows).map((r: any) => (Array.from(r))));
check("Correction direction: application summary cells match canonical rows", (isDeepStrictEqual(got,Array.from(STATS_SUMMARY).map((r: any) => (Array.from(r))))), (pyStr(slice(Array.from(got).filter((r: any) => truth(((!contains(STATS_SUMMARY, Array.from(r)))))).map((r: any) => (r)), 0, 2))));
check("Correction direction: code example uses correction=True", ((contains(t, "pg.ttest(group1, group2, correction=True)"))));
(auto=Array.from(lines(t)).filter((ln: any) => truth(((contains(ln, "correction='auto'"))))).map((ln: any) => (ln)));
check("Correction direction: correction='auto' remains only in an upstream comment", ((value:any)=>truth(value)?(isDeepStrictEqual(length(auto),1)):value)((Array.from(auto).map((ln: any) => (starts(lstrip(ln), "#")))).every((value:any)=>truth(value))), (pyStr(auto)));
check("Correction direction: precedence over upstream remains declared", ((contains(t, "**This document takes precedence over upstream.**"))));
}
function check_repro_direction(check:any):any{
let blocks:any,boxes:any,fp:any,items:any,k:any,m:any,man:any,nums:any,prov:any,r:any,rows:any,seeds:any,t:any,vals:any,want_keys:any,x:any;

(fp=join(REFS, "reproducibility.md"));
if(truth(!truth(isfile(fp)))) {
check("Reproducibility direction: reproducibility.md exists", false, "file missing");
return undefined;
}
(t=read(fp));
(nums=findall("(?m)^## Rule (\\d+):", t));
check("Reproducibility direction: rules run from 1 through 5", (isDeepStrictEqual(nums,["1", "2", "3", "4", "5"])), (pyStr(nums)));
(boxes=findall("(?m)^- \\[ \\] ", t));
check("Reproducibility direction: review checklist has eight items", (isDeepStrictEqual(length(boxes),8)), (pyStr(length(boxes)) + " items"));
(prov=at(split(at(split(t, "## Rule 3", 1), -(1)), "\n## ", 1), 0));
(items=findall("(?m)^(\\d)\\. \\*\\*", prov));
check("Reproducibility direction: five-field provenance declaration matches item count", ((value:any)=>truth(value)?(isDeepStrictEqual(items,["1", "2", "3", "4", "5"])):value)(((contains(prov, "Record five fields")))), (pyStr(items)));
(seeds={"code": search("(?m)^SEED = (\\d+)", t), "command": search("--seed (\\d+)", t), "manifest": search("\"seed\": (\\d+)", t)});
(vals=Object.fromEntries(Array.from(Object.entries(seeds)).map(([k, m]: any) => ([k, (truth(m) ? group(m, 1) : null)]))));
check("Reproducibility direction: seed matches in code, command, and manifest", ((value:any)=>truth(value)?(isDeepStrictEqual(length(new Set(Object.values(vals))),1)):value)(((!contains(Object.values(vals), null)))), (pyStr(vals)));
(blocks=findall("(?s)"+"```json\\n(.*?)```",t));
try {(man=(truth(blocks) ? JSON.parse(at(blocks, 0)) : null));
check("Reproducibility direction: manifest example is valid JSON", ((man !== null)), (truth(((man === null))) ? "```json block missing" : ""));}catch(exc){(man=null);
check("Reproducibility direction: manifest example is valid JSON", false, slice(pyStr(exc), 0, 60));}
(want_keys=new Set(["run_id", "seed", "env", "data", "code", "outputs"]));
check("Reproducibility direction: manifest contains all six fields", ((value:any)=>truth(value)?(isDeepStrictEqual(new Set(Object.keys(man)),want_keys)):value)(isinstance(man, "dict")), (pyStr((truth(isinstance(man, "dict")) ? sorted(man) : man))));
(rows=Array.from(table_rows(t, "## Rule 2")).filter((r: any) => truth((isDeepStrictEqual(length(r),3)))).map((r: any) => (Array.from(r))));
check("Reproducibility direction: lockfile table matches canonical rows", (isDeepStrictEqual(rows,Array.from(REPRO_LOCK).map((r: any) => (Array.from(r))))), (pyStr(slice(Array.from(rows).filter((r: any) => truth(((!contains(Array.from(REPRO_LOCK).map((x: any) => (Array.from(x))), r))))).map((r: any) => (r)), 0, 2))));
check("Reproducibility direction: partial reproduction is not accepted as reproducible", ((value:any)=>truth(value)?((contains(t, "Do not claim reproducibility if any item is missing"))):value)(((contains(t, "Partial reproduction does")))));
}
const PROBE_CASES=[["swap six decision pairs while preserving counts", "tier A: decisions match the authoritative list row by row"], ["retain one duplicate", "tier A: all five duplicates are excluded"], ["replace an alternative with another skill", "tier A: replacements for five duplicates match the authority"], ["delete the roster table", "tier A: roster table was read"]];
function _probe_unmeasured(check:any,why:any):any{
let _:any,label:any;

check("Mutation probe: every check passes in the unchanged copy", false, why);
for (let [label, _] of PROBE_CASES) {
check(("Mutation probe: checker catches " + pyStr(label)), false, why);
}
}
function check_roster_probe(check:any):any{
let OFF:any,_absent:any,bad:any,base:any,d:any,doc:any,f:any,fp:any,got:any,k:any,label:any,ln:any,mod:any,mutate:any,mutators:any,n:any,name:any,ok:any,out:any,spec:any,tmp:any,vp:any;

(fp=join(HERE, "test_tier_a_roster.js"));
(mod=moduleRoster);
(_absent=Array.from(["run", "DUPLICATES"]).filter((n: any) => truth(!truth((n in mod)))).map((n: any) => (n)));
if(truth(_absent)) {
_probe_unmeasured(check, ("checker is missing " + pyStr(_absent)));
return undefined;
}
function probe(mutate:any):any{
let doc:any,f:any,got:any,n:any,tmp:any,vp:any;
(tmp=temporaryDirectory());
try {symlinkSync(REPOS, join(tmp, "repos"));
mkdirSync(join(tmp, "references"));
for (let n of ["tier-a-verdicts.md", "_sources.json", "analysis-methodology.md"]) {
copyFileSync(join(REFS, n), join(tmp, "references", n));
}
(vp=join(tmp, "references", "tier-a-verdicts.md"));
{const f=fileHandle(vp,"r");(doc=f.read());}
{const f=fileHandle(vp,"w");f.write(mutate(doc));}
(got={});
mod.run((n:any,ok:any,d:any)=>(got[n]=ok), tmp);
return got;}finally{removeTree(tmp, {ignore_errors: true});}
}
(OFF="tier A: in-tree replacement skills exist");
function swap6(doc:any):any{
let d:any,k:any,ln:any,n:any,out:any;

([out, k, d]=[[], 0, 0]);
for (let ln of lines(doc)) {
if(truth(((value:any)=>truth(value)?((value:any)=>truth(value)?(compare(k,6,"<")):value)(((contains(ln, "| 존치 |")))):value)(starts(ln, "| `")))) {
([ln, k]=[replace(ln, "| 존치 |", "| 배제 |"), (k + 1)]);
} else {
if(truth(((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?!truth((Array.from(mod.DUPLICATES).map((n: any) => (((contains(at(split(ln, "|"), 1), ("`" + pyStr(n) + "`"))))))).some((value:any)=>truth(value))):value)((compare(d,6,"<"))):value)(((contains(ln, "| 배제 |")))):value)(starts(ln, "| `")))) {
([ln, d]=[replace(ln, "| 배제 |", "| 존치 |"), (d + 1)]);
}
}
out.push(ln);
}
return joinText("\n", out);
}
(base=probe((doc:any)=>doc));
(bad=sorted(Array.from(Object.entries(base)).filter(([n, ok]: any) => truth(((value:any)=>truth(value)?(!isDeepStrictEqual(n,OFF)):value)(!truth(ok)))).map(([n, ok]: any) => (n))));
check("Mutation probe: every check passes in the unchanged copy", !truth(bad), (pyStr(slice(bad, 0, 3))));
(mutators=[swap6, (doc:any)=>replace(doc, "/scientific-writing/SKILL.md` | 배제 |", "/scientific-writing/SKILL.md` | 존치 |"), (doc:any)=>replace(doc, "`research`(이 저장소) | One of five direct overlaps.", "`hwpx`(이 저장소) | One of five direct overlaps."), (doc:any)=>sub("(?m)^\\| `.+$", "", doc)]);
for (let [[label, name], mutate] of zip(PROBE_CASES, mutators)) {
(got=probe(mutate));
check(("Mutation probe: checker catches " + pyStr(label)), (((got[name] ?? null) === false)), (pyStr(name) + " = " + pyStr((got[name] ?? null))));
}
}
function load_pure(_path:string,names:Iterable<string>,constNames:Iterable<string>=[]):any{for(const name of [...names,...constNames])if(!(name in moduleGenerator))throw Error('Missing generator export: '+name);return moduleGenerator;}
function _regen_unmeasured(check:any,why:any):any{
let _n:any;

for (let _n of ["does not count directory symlinks as real files", "does not change a byte outside the table"]) {
check(("Generator behavior: " + pyStr(_n)), false, ("unmeasured — " + pyStr(why)));
}
}
function check_regen_behaviour(check:any):any{
let doc:any,f:any,fp:any,g:any,got:any,missing:any,n:any,ns:any,out:any,real:any,tail:any,tmp:any;

(fp=join(ROOT, "scripts", "rebuild-index.js"));
try {(ns=load_pure(fp, new Set(["skill_files", "replace_table"]), new Set(["HEAD_ROW"])));}catch(exc){check("Generator behavior: pure functions can be extracted", false, slice(pyStr(exc), 0, 80));
_regen_unmeasured(check, "could not extract pure functions");
return undefined;}
(missing=Array.from(["skill_files", "replace_table", "HEAD_ROW"]).filter((n: any) => truth(((!contains(ns, n))))).map((n: any) => (n)));
check("Generator behavior: instrumented functions exist", !truth(missing), (pyStr(missing)));
if(truth(missing)) {
_regen_unmeasured(check, ("missing " + pyStr(missing)));
return undefined;
}
(tmp=temporaryDirectory());
try {(real=join(tmp, "alpha"));
mkdirSync(real,{recursive:true});
{const f=fileHandle(join(real, "SKILL.md"),"w");f.write("---\nname: alpha\n---\n");}
mkdirSync(join(tmp, "skills"),{recursive:true});
symlinkSync(real, join(tmp, "skills", "alpha"));
(got=at(ns, "skill_files")(tmp));
check("Generator behavior: does not count directory symlinks as real files", (isDeepStrictEqual(length(got),1)), (pyStr(length(got)) + " items — " + pyStr(Array.from(got).map((g: any) => (relative(tmp,g))))));}finally{removeTree(tmp, {ignore_errors: true});}
(tail="\n## Local decisions\n\nThis section must remain.\n\n## Updating\n");
(doc=((at(ns, "HEAD_ROW") + "| `a.md` | 1 | A |\n| `b.md` | 2 | B |\n") + tail));
(out=at(ns, "replace_table")(doc, "| `c.md` | 3 | C |"));
check("Generator behavior: does not change a byte outside the table", (isDeepStrictEqual(out,((at(ns, "HEAD_ROW") + "| `c.md` | 3 | C |\n") + tail))), slice(replace(out, "\n", "\\n"), 0, 110));
}
function check_catalog_index(check:any,skill:any,sources:any):any{
let byte_errors:any,count_errors:any,counts:any,d:any,data:any,f:any,handle:any,index:any,n:any,path:any,r:any,routes:any,row:any,rows:any,tag:any,valid:any;

try {(index=JSON.parse(read(join(REFS, "_index.json"))));}catch(error){(index=null);}
(valid=((value:any)=>truth(value)?truth(index):value)(isinstance(index, "list")));
if(truth(valid)) {
(valid=(Array.from(index).map((row: any) => (((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?(compare(at(row, "bytes"),0,">")):value)(Number.isInteger(at(row,"bytes"))):value)((compare(at(row, "count"),0,">"))):value)(Number.isInteger(at(row,"count"))):value)(/^[a-z0-9-]+\.md$/.test(at(row,"file"))):value)(isinstance(at(row, "file"), "str")):value)(truth(at(row, "domain"))):value)(isinstance(at(row, "domain"), "str")):value)((isDeepStrictEqual(new Set(Object.keys(row)),new Set(["domain", "file", "count", "bytes"])))):value)(isinstance(row, "dict"))))).every((value:any)=>truth(value)));
}
if(truth(valid)) {
(valid=(isDeepStrictEqual(length(new Set(Array.from(index).map((row: any) => (at(row, "file"))))),length(index)) && isDeepStrictEqual(length(index),length(new Set(Array.from(index).map((row: any) => (at(row, "domain"))))))));
}
(rows=(truth(valid) ? index : []));
(routes=findall("(?m)^\\|\\s*`([a-z0-9_.-]+\\.md)`\\s*\\|\\s*(\\d+)\\s*\\|\\s*([^|]+?)\\s*\\|", skill));
check("Index: JSON schema and unique per-domain files are valid", truth(valid));
check("Index: public routing table matches files, counts, and domains", ((value:any)=>truth(value)?(isDeepStrictEqual(Array.from(rows).map((r: any) => ([at(r, "file"), at(r, "count"), at(r, "domain")])),Array.from(routes).map(([f, n, d]: any) => ([f, Number(n), d])))):value)(truth(valid)));
([byte_errors, count_errors]=[[], []]);
for (let row of rows) {
(path=join(REFS, at(row, "file")));
try {{const handle=fileHandle(path,"rb");(data=handle.read());}
if(truth((!isDeepStrictEqual(length(data),at(row, "bytes"))))) {
byte_errors.push(at(row, "file"));
}
if(truth((!isDeepStrictEqual(length(findall("(?m)^- \\*\\*", data.toString("utf8"))),at(row, "count"))))) {
count_errors.push(at(row, "file"));
}}catch(error){byte_errors.push(at(row, "file"));
count_errors.push(at(row, "file"));}
}
check("Index: files exist and recorded bytes match the catalogs", ((value:any)=>truth(value)?!truth(byte_errors):value)(truth(valid)), pyStr(byte_errors));
check("Index: per-domain skill counts match catalog entry counts", ((value:any)=>truth(value)?!truth(count_errors):value)(truth(valid)), pyStr(count_errors));
(counts=Array.from(["academic", "gdm", "kdense"]).map((tag: any) => (((sources[tag] ?? {})["skill_count"] ?? null))));
check("Index: total entries match pinned per-source skill counts", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual((Array.from(rows).map((r: any) => (at(r, "count")))).reduce((total:number,value:any)=>total+Number(value),0),(counts).reduce((total:number,value:any)=>total+Number(value),0))):value)((Array.from(counts).map((n: any) => (((value:any)=>truth(value)?(compare(n,0,">")):value)(Number.isInteger(n))))).every((value:any)=>truth(value))):value)(truth(valid)));
check("Index: rows are sorted by descending count and domain name", ((value:any)=>truth(value)?(isDeepStrictEqual(rows,[...rows].sort((a:any,b:any)=>b.count-a.count||a.domain.localeCompare(b.domain,"en")))):value)(truth(valid)));
}
function check_vendor_count(check:any,src:any,skill:any,fm:any,notice:any):any{
let _:any,base:any,d:any,declarations:any,declared:any,dns:any,dp:any,fns:any,measured:any,n:any,needle:any,rows:any,tag:any,text:any,total:any,where:any;

(measured={});
for (let tag of sorted(src)) {
(base=join(REPOS, tag));
(n=0);
for (let [dp, dns, fns] of walk(base, {followlinks: false})) {
dns.splice(0,dns.length,...Array.from(dns).filter((d: any) => truth(!truth(islink(join(dp, d))))).map((d: any) => (d)));
if(truth(((contains(fns, "SKILL.md"))))) {
n+=1;
}
}
(measured[tag]=n);
}
(declared=Object.fromEntries(Object.keys(src).map((tag: any) => ([tag, (at(src, tag)["skill_count"] ?? null)]))));
check("Accounting: _sources.json skill counts match disk (excluding symlinks)", (Object.keys(measured).length > 0 && isDeepStrictEqual(measured,declared)), ("measured " + pyStr(measured) + " / declared " + pyStr(declared)));
(total=(Object.values(measured)).reduce((total:number,value:any)=>total+Number(value),0));
(rows=findall("(?m)^\\|\\s*`([a-z0-9_.-]+\\.md)`\\s*\\|\\s*(\\d+)\\s*\\|", skill));
check("Accounting: routing-table total exactly matches disk", (isDeepStrictEqual((Array.from(rows).map(([_skip0, n]: any) => (Number(n)))).reduce((total:number,value:any)=>total+Number(value),0),total)), ("table " + pyStr((Array.from(rows).map(([_skip0, n]: any) => (Number(n)))).reduce((total:number,value:any)=>total+Number(value),0)) + " / measured " + pyStr(total)));
(declarations=[["description", fm, (pyStr(total) + " science and research skills")], ["body", skill, ("Organizes " + pyStr(total) + " child skills")], ["NOTICE", notice, ("points to " + pyStr(total) + " skills")]]);
for (let [where, text, needle] of declarations) {
check(("Accounting: " + pyStr(where) + " declared total matches disk"), (where === "description" ? (!/\b\d+ science and research skills/.test(text) || text.includes(needle)) : text.includes(needle)), ((pyStr(total) + " missing — ") + joinText(", ", sorted(new Set(findall("\\b(\\d{3})", text))))));
}
for (let tag of ["academic", "gdm", "kdense"]) {
if(truth(((!contains(src, tag))))) {
check(("Accounting: NOTICE " + pyStr(tag) + " skill count matches disk"), false, "source missing from _sources.json");
continue;
}
(n=at(measured, tag));
check(("Accounting: NOTICE " + pyStr(tag) + " skill count matches disk"), ((search(("\\| `"+tag+"` \\|[^|]*\\|\\s*"+n+"\\s*\\|"), notice) !== null)), ("measured " + pyStr(n)));
}
check("Generator: does not follow directory symlinks", ((value:any)=>truth(value)?((contains(read(join(ROOT, "scripts", "rebuild-index.js")), "isSymbolicLink"))):value)(((contains(read(join(ROOT, "scripts", "rebuild-index.js")), "lstatSync")))));
}
function check_credit_lines(check:any,src:any):any{
let CRED:any,commit:any,creds:any,fp:any,lic:any,line:any,meta:any,n:any,repo:any,silent:any,tag:any,url:any,wrong:any;

(CRED=compiled("`([a-z]+)` = \\[([^\\]]+)\\]\\(([^)]+)\\) @ ([0-9a-f]{7}) \\(([^)]*)\\)"));
([wrong, silent]=[[], []]);
for (let n of sorted(REF_BYTES)) {
if(truth((isDeepStrictEqual(n,"_kdense-catalog.md")))) {
continue;
}
(fp=join(REFS, n));
if(truth(!truth(isfile(fp)))) {
continue;
}
(line=search("(?m)^출처: (.+)$", read(fp)));
if(truth(!truth(line))) {
silent.push(n);
continue;
}
(creds=CRED.findall(group(line, 1)));
if(truth(!truth(creds))) {
silent.push(n);
continue;
}
for (let [tag, repo, url, commit, lic] of creds) {
(meta=(src[tag] ?? null));
if(truth(((meta === null)))) {
wrong.push((pyStr(n) + ": unknown tag " + pyStr(tag)));
} else {
if(truth((!isDeepStrictEqual([repo, url, commit],[at(meta, "repo"), at(meta, "url"), slice(at(meta, "commit"), 0, 7)])))) {
wrong.push((pyStr(n) + ": " + pyStr(tag) + " repository/commit mismatch"));
} else {
if(truth((!isDeepStrictEqual(lic,at(meta, "license"))))) {
wrong.push((pyStr(n) + ": " + pyStr(tag) + " license " + pyStr(lic) + " != " + pyStr(at(meta, "license"))));
}
}
}
}
}
check("Attribution: every catalog has a machine-readable source line", !truth(silent), (pyStr(slice(silent, 0, 4))));
check("Attribution: source repository, commit, and license match _sources.json", !truth(wrong), (pyStr(slice(wrong, 0, 4))));
}
function check_catalog_identity(check:any):any{
let _:any,_root_real:any,ap:any,dupes:any,fp:any,linked:any,n:any,real:any,rel:any,s:any,slugs:any,t:any;

([dupes, linked]=[[], []]);
for (let n of sorted(REF_BYTES)) {
if(truth((isDeepStrictEqual(n,"_kdense-catalog.md")))) {
continue;
}
(fp=join(REFS, n));
if(truth(!truth(isfile(fp)))) {
continue;
}
(t=read(fp));
(slugs=Array.from(findall("(?m)^- \\*\\*(.+?)\\*\\* \\(`(.+?)`\\)", t)).map(([s, _skip0]: any) => (s)));
dupes.push(...(Array.from(sorted(new Set(Array.from(slugs).filter((s: any) => truth((compare(count(slugs, s),1,">")))).map((s: any) => (s))))).map((s: any) => ((pyStr(n) + ": " + pyStr(s))))));
(real=new Set());
(_root_real=realpathSync(ROOT));
for (let rel of findall("`(repos/[^`]+SKILL\\.md)`", t)) {
(ap=join(ROOT, rel));
if(truth((!isDeepStrictEqual(realpathSync(ap),join(_root_real, rel))))) {
linked.push((pyStr(n) + ": " + pyStr(rel)));
}
real.add(realpathSync(ap));
}
if(truth((!isDeepStrictEqual(length(real),length(new Set(findall("`(repos/[^`]+SKILL\\.md)`", t))))))) {
dupes.push((pyStr(n) + ": different paths point to the same file"));
}
}
check("Accounting: catalogs do not list the same skill twice", !truth(dupes), (pyStr(slice(dupes, 0, 4))));
check("Accounting: catalog paths contain no directory symlinks", !truth(linked), (pyStr(slice(linked, 0, 4))));
}
function check_science_refs(check:any):any{
let count_off:any,dead_path:any,declared:any,ents:any,f:any,fp:any,got:any,m:any,missing_files:any,n:any,no_src:any,on_disk:any,rel:any,src:any,t:any,thin:any;

(missing_files=Object.keys(REF_BYTES).filter((n: any) => truth(!truth(isfile(join(REFS, n))))).map((n: any) => (n)));
check("References: every declared document exists", !truth(missing_files), (pyStr(missing_files)));
(on_disk=sorted(Array.from(readdirSync(REFS)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (f))));
(declared=new Set([...Object.keys(REF_BYTES),...Object.keys(OWN_REFS)]));
check("References: files on disk match the declared list", (isDeepStrictEqual(on_disk,sorted(declared))), ("undeclared " + pyStr(sorted(on_disk.filter((name:string)=>!declared.has(name)))) + " / missing " + pyStr(sorted([...declared].filter(name=>!on_disk.includes(name))))));
([thin, count_off, dead_path, no_src]=[[], [], [], []]);
for (let n of sorted(REF_BYTES)) {
(fp=join(REFS, n));
if(truth(!truth(isfile(fp)))) {
continue;
}
(t=read(fp));
(got=content_bytes(t, []));
if(truth((compare(got,at(REF_BYTES, n),"<")))) {
thin.push((pyStr(n) + ": " + pyStr(got) + "B < " + pyStr(at(REF_BYTES, n)) + "B"));
}
if(truth((isDeepStrictEqual(n,"_kdense-catalog.md")))) {
continue;
}
(src=search("(?m)"+"^출처: (.+)$",t));
if(truth(((value:any)=>truth(value)?value:(compare(length(strip(group(src, 1))),20,"<")))(!truth(src)))) {
no_src.push(n);
}
(m=search("(?m)"+"^(\\d+) skills\\.",t));
(ents=findall("(?m)"+"^- \\*\\*(.+?)\\*\\* \\(`(.+?)`\\)",t));
if(truth(((value:any)=>truth(value)?value:(!isDeepStrictEqual(Number(group(m, 1)),length(ents))))(!truth(m)))) {
count_off.push((pyStr(n) + ": declared " + pyStr((truth(m) ? group(m, 1) : "missing")) + " / entries " + pyStr(length(ents))));
}
for (let rel of findall("`(repos/[^`]+SKILL\\.md)`", t)) {
if(truth(!truth(isfile(join(ROOT, rel))))) {
dead_path.push((pyStr(n) + ": " + pyStr(rel)));
}
}
}
check("References: no document fell below measured content volume", !truth(thin), (pyStr(slice(thin, 0, 4))));
check("References: catalogs retain source attribution", !truth(no_src), (pyStr(slice(no_src, 0, 6))));
check("References: declared counts match entry counts", !truth(count_off), (pyStr(slice(count_off, 0, 4))));
check("References: every referenced SKILL.md exists", !truth(dead_path), (pyStr(slice(dead_path, 0, 4))));
}
function check_own_refs(check:any):any{
let floor:any,fn:any,fp:any,needles:any;

for (let fn of sorted(OWN_REFS)) {
([needles, floor]=at(OWN_REFS, fn));
(fp=join(REFS, fn));
if(truth(!truth(isfile(fp)))) {
check(("Local reference: " + pyStr(fn) + " exists"), false, "file missing");
continue;
}
_ref_axes(check, ROOT, fn, fp, read(fp), needles, floor, "tests/refs", "Local reference");
}
}
function check_tier_a_roster(check:any):any{
let cand:any,fp:any,mod:any,n:any,spec:any,src:any;

(fp=join(HERE, "test_tier_a_roster.js"));
(src=(truth(isfile(fp)) ? read(fp) : ""));
check("tier A 로스터: checker reads tier-a-verdicts.md as authority", ((contains(src, "tier-a-verdicts.md"))));
check("tier A 로스터: checker compares sources with _sources.json", ((contains(src, "_sources.json"))));
check("tier A 로스터: checker names all five duplicates", (Array.from(["scientific-writing", "peer-review", "scientific-brainstorming", "scientific-visualization", "literature-review"]).map((n: any) => (((contains(src, n)))))).every((value:any)=>truth(value)));
(mod=null);
if(truth(strip(src))) {
(mod='run' in moduleRoster?moduleRoster:null);
}
if(truth(((mod === null)))) {
check("tier A 로스터: checker exposes run()", false, "tests/test_tier_a_roster.js is empty or has no run()");
return undefined;
}
mod.run(check, ROOT);
}
function main():any{
let NAME:any,_:any,_OFF:any,_ROSTER_OFF:any,_SRC_AXES:any,_TAGS:any,_t:any,_w:any,d:any,f:any,fm:any,fs:any,got:any,idx:any,joined:any,lf:any,lic:any,meta:any,missing:any,missing_s:any,n:any,n_ref:any,n_repo:any,notice:any,ok:any,passed:any,r:any,referred:any,rows:any,s:any,skill:any,skill_all:any,skills_dir:any,src:any,tag:any,want:any;
(skill_all=read(join(ROOT, "SKILL.md")));
([fm, skill]=split_frontmatter(skill_all));
(notice=read(join(ROOT, "NOTICE")));
check("Name: frontmatter matches roster (science)", ((search("(?m)^name:\\s*science\\s*$", fm) !== null)), (truth(((contains(fm, "name:")))) ? (search("(?m)^name:\\s*(.+)$", fm)?.[1]??"missing") : "missing"));
(src={});
(_TAGS=["academic", "gdm", "kdense"]);
(_SRC_AXES=["출처: _sources.json contains all three repositories"]);
for (let _t of _TAGS) {
_SRC_AXES.push(...([("출처: repos/" + pyStr(_t) + " exists"), ("출처: " + pyStr(_t) + " complete license text is imported"), ("출처: " + pyStr(_t) + " pinned commit is recorded"), ("출처: NOTICE identifies the " + pyStr(_t) + " repository")]));
}
for (let [_t, _w] of [["kdense", "MIT"], ["gdm", "Apache-2.0"], ["academic", "CC BY-NC 4.0"]]) {
_SRC_AXES.push(("라이선스: " + pyStr(_t) + " matches " + pyStr(_w) + " across _sources and NOTICE"));
}
section(check, results, ..._SRC_AXES).run(()=>{(src=JSON.parse(read(join(REFS, "_sources.json"))));
check("출처: _sources.json contains all three repositories", (isDeepStrictEqual(new Set(Object.keys(src)),new Set(["kdense", "gdm", "academic"]))), (pyStr(sorted(src))));
for (let [tag, meta] of sorted(Object.entries(src))) {
(d=join(REPOS, tag));
check(("출처: repos/" + pyStr(tag) + " exists"), isdir(d));
(lf=(meta["license_file"] ?? ""));
check(("출처: " + pyStr(tag) + " complete license text is imported"), ((value:any)=>truth(value)?existsSync(join(ROOT, lf)):value)(truth(lf)), ((value:any)=>truth(value)?value:"undeclared")(lf));
check(("출처: " + pyStr(tag) + " pinned commit is recorded"), truth((meta["commit"] ?? null)), (meta["commit"] ?? "missing"));
check(("출처: NOTICE identifies the " + pyStr(tag) + " repository"), ((contains(notice, (meta["repo"] ?? "\u0000")))), (meta["repo"] ?? ""));
}
for (let [tag, want] of [["kdense", "MIT"], ["gdm", "Apache-2.0"], ["academic", "CC BY-NC 4.0"]]) {
(got=((src[tag] ?? {})["license"] ?? ""));
check(("라이선스: " + pyStr(tag) + " matches " + pyStr(want) + " across _sources and NOTICE"), ((value:any)=>truth(value)?((contains(notice, want))):value)(((contains(got, at(split(want), 0))))), ("_sources=" + pyStr(got)));
}});
check("NC: NOTICE says academic prohibits commercial use", ((contains(notice, "NC prohibits commercial use"))));
check("NC: NOTICE requires assessment before paid work such as procurement", ((contains(notice, "Assess this before using them for paid work"))));
check("NC: NOTICE says the other two sources lack that restriction", ((contains(notice, "do not have that restriction"))));
(lic=read(join(REPOS, "academic", "LICENSE")));
check("NC: complete academic LICENSE identifies CC BY-NC", ((value:any)=>truth(value)?((contains(lic, "Creative Commons"))):value)(((contains(lic, "NonCommercial")))));
(rows=findall("(?m)^\\|\\s*`([a-z0-9_.-]+\\.md)`\\s*\\|\\s*(\\d+)\\s*\\|", skill));
check("Routing: file rows were parsed from the table", (compare(length(rows),20,">=")), (pyStr(length(rows)) + " rows"));
(missing=Array.from(rows).filter(([f, _skip0]: any) => truth(!truth(existsSync(join(REFS, f))))).map(([f, _skip0]: any) => (f)));
check("Routing: every referenced file exists", !truth(missing), ("missing " + pyStr(slice(missing, 0, 3))));
check_catalog_index(check, skill, src);
check_vendor_count(check, src, skill, fm, notice);
check_regen_behaviour(check);
(n_ref=length(Array.from(readdirSync(REFS)).filter((f: any) => truth(ends(f, ".md"))).map((f: any) => (f))));
check("Import: at least 30 reference documents exist", (compare(n_ref,30,">=")), (pyStr(n_ref) + " files"));
(n_repo=(Array.from(walk(REPOS)).map(([_base, _dirs, fs]: any) => (length(fs)))).reduce((total:number,value:any)=>total+Number(value),0));
check("Import: at least 2,000 repository files exist", (compare(n_repo,2000,">=")), (pyStr(n_repo) + " files"));
check("Boundary: local owners for document output are identified", (Array.from(["`office`", "`hwpx`", "`deck`", "`diagram`"]).map((s: any) => (((contains(skill, s)))))).every((value:any)=>truth(value)));
(skills_dir=dirname(ROOT));
(NAME="`([a-z][a-z-]{2,})`\\s+handles\\b");
(referred=sorted(new Set(findall(NAME, skill))));
(missing_s=Array.from(referred).filter((n: any) => truth(!truth(isdir(join(skills_dir, n))))).map((n: any) => (n)));
check("Boundary: referral population is nonempty", (compare(length(referred),3,">=")), (pyStr(referred)));
check("Boundary: every referral target exists", !truth(missing_s), ("missing " + pyStr(missing_s)));
check("Import rationale: team machines lack upstream files", ((contains(notice, "do not have those files"))));
check("Import rationale: manual update cost is disclosed", ((contains(notice, "manual tracking of upstream updates"))));
_ref_axes(check, ROOT, "NOTICE", join(ROOT, "NOTICE"), notice, ["**NC prohibits commercial use.**", "Assess this before using them for paid work", "do not have that restriction", "manual tracking of upstream updates"], NOTICE_FLOOR, "tests/refs", "Notice contract");
(idx=read(join(ROOT, "scripts", "rebuild-index.js")));
(joined=sub("'\\s*\\n\\s*'", "", idx));
check("Generator: upstream repositories match SKILL.md", ((value:any)=>truth(value)?((contains(skill, "K-Dense-AI/scientific-agent-skills"))):value)(((contains(joined, "K-Dense-AI/scientific-agent-skills")))));
check("Generator: catalog output path is below references/", ((contains(idx, "_kdense-catalog.md"))));
check("Generator: catalog output exists", isfile(join(ROOT, "references", "_kdense-catalog.md")));
check("Generator: SKILL.md documents this script path", ((contains(skill, "scripts/rebuild-index.js"))));
check("Generator: update instructions require running the suite", ((value:any)=>truth(value)?((contains(skill, "NOTICE"))):value)(((contains(skill, "tests/run_tests.js")))));
check("Generator: YAML parsing uses the imported package", ((value:any)=>truth(value)?((contains(idx, "parse("))):value)(((contains(idx, "yaml")))));
check_science_refs(check);
check_credit_lines(check, src);
check_catalog_identity(check);
check_own_refs(check);
check_stats_direction(check);
check_repro_direction(check);
check_tier_a_roster(check);
check_roster_probe(check);
check_skill_body(check, ROOT, {needles: ["vendors shallow clones", "follow its instructions exactly", "domain-specific scientific tools", "Use that skill by default"], floor: 6350});
(_OFF=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/rebuild-index.js": 7}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), _OFF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0), extra_skip: ["스크립트 계약:"]});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"NOTICE": 18, "references/_index.json": 6, "references/_sources.json": 27, "references/analysis-methodology.md": 9, "references/tier-a-verdicts.md": 23}, completeness: false, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), _OFF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0), extra_skip: _OFF});
(_ROSTER_OFF=[..._OFF,"tier A: ", "tier A 로스터:"]);
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"tests/test_tier_a_roster.js": 9}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), _ROSTER_OFF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0), extra_skip: ["스크립트 계약:", "tier A: ", "tier A 로스터:"]});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 17, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), _OFF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 139);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
