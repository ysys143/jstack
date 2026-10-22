/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync,cpSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,section,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;if(native.timeout!==undefined)native.timeout*=1000;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}

function zip(a:any[],b:any[]):any[]{return a.slice(0,b.length).map((v,i)=>[v,b[i]]);}
function next(values:any[],fallback:any=null):any{return values[0]??fallback;}

function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const SCRIPTS=join(ROOT, "scripts");
const _broken:string[]=[],moduleCache:Record<string,any>={};
for(const name of ['lint_taxonomy','prescan','reconcile','taxonomy_rules','checks']){try{moduleCache[name]=await import(new URL('../scripts/'+(name==='checks'?'golden_checks':name)+'.js',import.meta.url).href);}catch(error){_broken.push(name+': import failed: '+String(error));}}
function _need(name:string,...attrs:string[]):any{const mod=moduleCache[name];if(!mod)return null;const missing=attrs.filter(attr=>!(attr in mod));if(missing.length){_broken.push(name+': missing names '+missing.join(', '));return null;}return mod;}
const lint_taxonomy=_need("lint_taxonomy", "lint");
const prescan=_need("prescan", "build_candidates");
const reconcile=_need("reconcile", "reconcile");
const _tax=_need("taxonomy_rules", "parse_taxonomy", "normalize", "VALID_CLASSES");
const parse_taxonomy=_tax?.parse_taxonomy??null;
const normalize=_tax?.normalize??null;
const TAXONOMY=join(ROOT, "references", "ai-tell-taxonomy.md");
const GOLD_INPUT=join(HERE, "gold", "L_examples_input.txt");
const EN_TAXONOMY=join(ROOT, "references", "en-taxonomy.md");
const EN_GOLD=join(HERE, "gold", "en_examples_input.txt");
function build_detection(cand:any,keep_ids:any=new Set(),{poison=false,bad_hash=false}:any={}):any{
let c:any,candidates:any,findings:any,h:any,i:any,info:any,kept:any,rid:any;

(candidates=Array.from(at(cand, "candidates")));
([findings, kept]=[[], []]);
for (let [i, c] of enumerate(candidates)) {
if(truth(((value:any)=>truth(value)?(isDeepStrictEqual(i,0)):value)(poison))) {
continue;
}
if(truth(((contains(keep_ids, at(c, "candidate_id")))))) {
kept.push({"candidate_id": at(c, "candidate_id"), "rule_id": at(c, "rule_id"), "reason": "물리적 문 손잡이", "evidence": "문 손잡이"});
} else {
findings.push({"id": ("f" + pyStr(i)), "candidate_id": at(c, "candidate_id"), "category": at(c, "rule_id"), "severity": at(c, "severity"), "scope": "span", "text_span": at(c, "text_span"), "start": at(c, "start"), "end": at(c, "end"), "reason": "test", "suggested_fix": "test"});
}
}
for (let [rid, info] of Object.entries(at(at(cand, "meta"), "computed_rules"))) {
if(truth(at(info, "triggered"))) {
findings.push({"id": ("fc_" + pyStr(rid)), "category": rid, "scope": "document", "reason": "computed", "suggested_fix": "리듬 변주"});
}
}
(h=at(at(cand, "meta"), "taxonomy_hash"));
return {"meta": {"taxonomy_version": at(at(cand, "meta"), "taxonomy_version"), "taxonomy_hash": (truth(bad_hash) ? "deadbeef" : h)}, "findings": findings, "kept": kept};
}
const UPSTREAM=join(HERE, "upstream-0.6.0");
const UPSTREAM_MANIFEST=join(ROOT, "UPSTREAM.sha256");
const UPSTREAM_PARITY:[string,number][]=[["ai-tell-taxonomy.md", 96], ["procurement-taxonomy.md", 34]];
function check_upstream_parity(check:any):any{
let _:any,_floor:any,a:any,actual:any,b:any,declared:any,digest:any,f:any,floor:any,line:any,name:any,ours:any,pat:any,path:any,rel:any,up:any;

if(truth(!truth(isdir(UPSTREAM)))) {
check("Upstream parity: frozen copy exists", false, (pyStr(UPSTREAM) + " missing; it must exist in the repository. Restore if deleted."));
return undefined;
}
(declared={});
if(truth(isfile(UPSTREAM_MANIFEST))) {
{const f=fileHandle(UPSTREAM_MANIFEST,"r");for (let line of lines(f.read())) {
(line=strip(line));
if(truth(((value:any)=>truth(value)?value:starts(line, "#"))(!truth(line)))) {
continue;
}
([digest, _, rel]=[line.slice(0,line.indexOf("  ")),"  ",line.slice(line.indexOf("  ")+2)]);
(declared[basename(rel)]=digest);
}}
}
check("Upstream parity: manifest declares both files", (isDeepStrictEqual(length(declared),2)), (pyStr(sorted(declared))));
for (let [name, _floor] of UPSTREAM_PARITY) {
(digest=(declared[name] ?? null));
(path=join(UPSTREAM, name));
(actual=(truth(isfile(path)) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null));
check(("Upstream parity: " + pyStr(name) + " matches its manifest hash"), ((value:any)=>truth(value)?(isDeepStrictEqual(actual,digest)):value)(((digest !== null))), ("measured " + pyStr((truth(actual) ? slice(actual, 0, 12) : "file missing")) + " / declared " + pyStr((truth(digest) ? slice(digest, 0, 12) : "none"))));
}
for (let [name, floor] of UPSTREAM_PARITY) {
(up=join(UPSTREAM, name));
(ours=join(ROOT, "references", name));
if(truth(!truth(((value:any)=>truth(value)?isfile(ours):value)(isfile(up))))) {
check(("Upstream parity: " + pyStr(name) + " exists on both sides"), false, (pyStr(up) + " / " + pyStr(ours)));
continue;
}
(pat="^#{2,3} ([A-Z]~?[A-Z]?-?\\d*)\\.");
{const f=fileHandle(up,"r");(a=new Set(findall("(?m)"+pat,f.read())));}
{const f=fileHandle(ours,"r");(b=new Set(findall("(?m)"+pat,f.read())));}
check(("Upstream parity: " + pyStr(name) + " has at least " + pyStr(floor) + " categories"), (compare(length(a),floor,">=")), ("upstream " + pyStr(length(a)) + " (floor " + pyStr(floor) + ")"));
check(("Upstream parity: " + pyStr(name) + " loses no categories"), !truth(new Set([...a].filter(value=>!b.has(value)))), ("missing " + pyStr(sorted(new Set([...a].filter(value=>!b.has(value)))))));
}
}
function main():any{
let AUDIT:any,AUDIT_AXES:any,GOLDEN_CASES:any,L:any,MUTATIONS:any,REF_CONTRACTS:any,SUBTESTS:any,TAX:any,_:any,_a:any,_after:any,_ak:any,_applied:any,_ax:any,_axis:any,_b:any,_before:any,_bl:any,_bl2:any,_bl_dir:any,_bodytxt:any,_codes:any,_content_run:any,_content_test:any,_ctl:any,_dead:any,_declared:any,_desc:any,_f:any,_fp:any,_genres:any,_golden:any,_kind:any,_kinds:any,_kinds2:any,_label:any,_mdst:any,_mut:any,_mwork:any,_n:any,_name:any,_nm:any,_ok:any,_orig:any,_ov:any,_path:any,_r:any,_ra:any,_rd:any,_rel:any,_rep:any,_rj:any,_rm:any,_rules:any,_rv:any,_sub:any,_subject:any,_tail:any,_token:any,_tp:any,_want:any,a:any,alias:any,b:any,bad:any,bad_det:any,bcand:any,binp:any,c:any,c12c:any,c12inp:any,cand:any,cand_path:any,ccand:any,ccand_path:any,cerrs:any,cinp:any,corrupt:any,corrupt_txt:any,crit:any,crit_path:any,declared:any,det:any,det2:any,det3:any,det_bad:any,det_noev:any,det_path:any,det_poison:any,ecand:any,einp:any,empty_root:any,errs:any,f:any,flag:any,gold_text:any,i:any,k:any,keep_ids:any,key:any,label:any,live_ran:any,m:any,m15:any,metaphor:any,mode:any,modes:any,n:any,nxt:any,ok:any,out:any,p:any,passed:any,phys:any,pp:any,r:any,rc:any,real:any,ref:any,rest:any,rp:any,rq:any,rules_hit:any,s:any,sect:any,sk:any,spans:any,tax_p:any,tmp:any,triggered:any,txt:any,v:any,v3c:any,v3hit:any,v3inp:any,v3want:any,vg:any,why:any,x:any;
for (let why of _broken) {
check("Missing script", false, why);
}
(tmp=temporaryDirectory());
(cand_path=join(tmp, "02_candidates.json"));
(det_path=join(tmp, "02_detection.json"));
section(check, results, "lint: valid taxonomy passes", "lint: missing surface taxonomy FAIL", "prescan: L-6 '축에서' recall restored", "prescan: no false positives on compounds 결과/구축", "prescan: identify physical L-8 (문 손잡이) candidate by content", "reconcile: passes when all candidates are resolved", "reconcile: poison (unresolved candidate) FAIL", "reconcile: hash mismatch FAIL", "reconcile: keep without evidence FAIL", "prescan: seven new v3.0 rules trigger", "COMPUTED: C-12 comma inclusion rate triggers").run(()=>{([_, errs]=lint_taxonomy.lint(TAXONOMY));
check("lint: valid taxonomy passes", !truth(errs), (pyStr(length(errs)) + " errors"));
(corrupt=join(tmp, "corrupt.md"));
{const f=fileHandle(TAXONOMY,"r");(txt=f.read());}
(corrupt_txt=subOnce("- 표층형: `손잡이`\\n", "", txt));
{const f=fileHandle(corrupt,"w");f.write(corrupt_txt);}
([_, cerrs]=lint_taxonomy.lint(corrupt));
check("lint: missing surface taxonomy FAIL", truth(cerrs), (pyStr(length(cerrs)) + " errors detected"));
(cand=prescan.build_candidates(GOLD_INPUT, TAXONOMY));
{const f=fileHandle(cand_path,"w");f.write(JSON.stringify(cand));}
(spans=new Set(Array.from(at(cand, "candidates")).map((c: any) => (strip(at(c, "text_span"))))));
check("prescan: L-6 '축에서' recall restored", (Array.from(spans).map((s: any) => (((contains(s, "축")))))).some((value:any)=>truth(value)), (pyStr(at(at(cand, "meta"), "candidate_count")) + " candidates"));
check("prescan: no false positives on compounds 결과/구축", !truth((Array.from(spans).map((s: any) => (((contains(["결과", "구축"], s)))))).some((value:any)=>truth(value))));
(gold_text=normalize(readFileSync(GOLD_INPUT,"utf8")));
(phys=(gold_text.indexOf("문 손잡이") + length("문 ")));
(keep_ids=new Set(Array.from(at(cand, "candidates")).filter((c: any) => truth(((value:any)=>truth(value)?(isDeepStrictEqual(at(c, "start"),phys)):value)((isDeepStrictEqual(at(c, "rule_id"),"L-8"))))).map((c: any) => (at(c, "candidate_id")))));
check("prescan: identify physical L-8 (문 손잡이) candidate by content", truth(keep_ids), (truth(keep_ids) ? "" : "gold '문 손잡이' match failed; cannot verify keep path"));
(det=build_detection(cand,keep_ids));
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det));}
(r=reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT));
check("reconcile: passes when all candidates are resolved", !truth(at(r, "failures")), pyStr(slice(at(r, "failures"), 0, 1)));
(det_poison=build_detection(cand,keep_ids,{poison:true}));
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det_poison));}
(r=reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT));
check("reconcile: poison (unresolved candidate) FAIL", (Array.from(at(r, "failures")).map((x: any) => (((contains(x, "unresolved")))))).some((value:any)=>truth(value)), (pyStr(length(at(r, "failures"))) + " failures"));
(det_bad=build_detection(cand,keep_ids,{bad_hash:true}));
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det_bad));}
(r=reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT));
check("reconcile: hash mismatch FAIL", (Array.from(at(r, "failures")).map((x: any) => (((contains(x, "hash")))))).some((value:any)=>truth(value)), (pyStr(length(at(r, "failures"))) + " failures"));
(det_noev=build_detection(cand,keep_ids));
for (let k of at(det_noev, "kept")) {
delete k.evidence;
}
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det_noev));}
(r=reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT));
check("reconcile: keep without evidence FAIL", ((value:any)=>truth(value)?(Array.from(at(r, "failures")).map((x: any) => (((contains(x, "keep evidence")))))).some((value:any)=>truth(value)):value)(truth(at(det_noev, "kept"))));
(v3inp=join(tmp, "v3.txt"));
{const f=fileHandle(v3inp,"w");f.write("긴장으로부터의 해방. 데이터를 정제하고, 검증한다. 단순히 도구가 아니라 파트너다. 속도라기보다 방향이다. 1) 하나 2) 둘 3) 셋이다. 양쪽 모두 일리가 있고 신중하게 본다. '규모'를 넘어 '전략'으로 간다. seamless하고 robust한 경험.\n");}
(v3c=prescan.build_candidates(v3inp, TAXONOMY));
(v3hit=new Set(Array.from(at(v3c, "candidates")).map((c: any) => (at(c, "rule_id")))));
(v3want=new Set(["A-19", "C-8", "C-9", "C-11", "G-3", "D-7", "B-2"]));
check("prescan: seven new v3.0 rules trigger", (compare(v3want,v3hit,"<=")), ("missing " + pyStr(sorted(new Set([...v3want].filter(value=>!v3hit.has(value)))))));
(c12inp=join(tmp, "c12.txt"));
{const f=fileHandle(c12inp,"w");f.write("기술이 발전하면서, 시장이 커졌다. 비용이 내리자, 수요가 늘었다. 규제가 풀리며, 진입이 쉬워졌다. 인재가 모이고, 자본이 몰렸다. 경쟁이 붙으면서, 품질이 올랐다. 요약하면, 선순환이다.\n");}
(c12c=prescan.build_candidates(c12inp, TAXONOMY));
check("COMPUTED: C-12 comma inclusion rate triggers", ((at(at(c12c, "meta"), "computed_rules")["C-12"] ?? {})["triggered"] ?? false));});

(vg=join(SCRIPTS, "verify_gates.js"));
function run_gate(before:any,after:any):any{
let a:any,b:any,r:any;
([b, a]=[join(tmp, "gb.txt"), join(tmp, "ga.txt")]);
writeFileSync(b,before);
writeFileSync(a,after);
(r=subprocessRun([process.execPath, vg, "--before", b, "--after", a, "--genre", "essay"],{capture_output:true,text:true}));
return [r.returncode, r.stdout];
}
([rc, _]=run_gate("문장이 하나 있다. 그대로 둔다.", "문장이 하나 있다. 그대로 둔다."));
check("verify_gates: identical text converges with exit 0", (isDeepStrictEqual(rc,0)), ("exit=" + pyStr(rc)));
([_, out]=run_gate("이것은 단순히 A가 아니라 B다. ".repeat(5), "B가 핵심이다. ".repeat(5)));
check("verify_gates: detects C-8 antithesis annihilation", ((value:any)=>truth(value)?((contains(out, "5 → 0"))):value)(((contains(out, "전멸")))));
([_, out]=run_gate("성능의 손잡이다. 축을 본다. 셈이다. 사실상 표준. 결이 다르다. 맞물린다.", "성능을 조절한다. 기준을 본다. 그렇다. 표준. 방향이 다르다. 연동된다."));
check("verify_gates: L metaphor annihilation WARN (P2b)", ((value:any)=>truth(value)?((contains(out, "전멸(물리적"))):value)(((contains(out, "P2b")))));
([rc, out]=run_gate("첫째 문장이다. 둘째 문장이다. 셋째 문장이다. 넷째 문장이다.", "전혀 다른 하나. 완전히 바뀐 둘. 새로 쓴 셋. 갈아엎은 넷."));
check("verify_gates: excessive change rate ABORT exit 2", ((value:any)=>truth(value)?((contains(out, "ABORT"))):value)((isDeepStrictEqual(rc,2))), ("exit=" + pyStr(rc) + " / ABORT " + pyStr((truth(((contains(out, "ABORT")))) ? "present" : "absent"))));

(_golden=_need("checks", "run_checks"));
check("golden: scripts/golden_checks.js provides run_checks", ((_golden !== null)), (truth(_golden) ? "" : joinText("; ", slice(_broken, -(1)))));
if(truth(true)) {
(GOLDEN_CASES=[["legitimate rewriting passes (control)", "## 머리말\n\n연구를 진행하였다. 결과는 명확하다.\n", "## 머리말\n\n연구를 진행했다. 결과는 분명하다.\n", null], ["hayeot_injection", "연구를 했다. 결과는 명확하다.\n", "연구를 하였다. 결과는 명확하였다.\n", "hayeot_injection"], ["heading_lost", "## 머리말\n\n본문이다.\n", "본문이다.\n", "heading_lost"], ["footnote_count", "본문이다1).\n\n1) 각주 내용.\n", "본문이다.\n\n1) 각주 내용.\n", "footnote_count"], ["footnote_def", "본문이다1).\n\n1) 각주 내용.\n", "본문이다1).\n\n1) 전혀 다른 내용.\n", "footnote_def"], ["quote_altered", "그는 \"정확한 인용문이 여기 있다\"라고 말했다.\n", "그는 \"부정확한 인용문이 저기 있다\"라고 말했다.\n", "quote_altered"], ["number_injected", "매출이 늘었다.\n", "매출이 42% 늘었다.\n", "number_injected"]]);
for (let [_label, _before, _after, _want] of GOLDEN_CASES) {
if(truth(((_golden === null)))) {
check(("golden: " + pyStr(_label)), false, "scripts/golden_checks.js does not provide run_checks");
continue;
}
(_codes=Array.from(_golden.run_checks(_before, _after)).map((f: any) => (f.code)));
(_ok=(truth(((_want === null))) ? !truth(_codes) : ((contains(_codes, _want)))));
check(("golden: " + pyStr(_label)), _ok, ("codes=" + pyStr(_codes)));
}
}
(rq=join(SCRIPTS, "req_coverage.js"));
function run_req(req_ids:any,proposal:any):any{
let pp:any,r:any,rp:any;
([rp, pp]=[join(tmp, "req.txt"), join(tmp, "prop.txt")]);
writeFileSync(rp,req_ids);
writeFileSync(pp,proposal);
(r=subprocessRun([process.execPath, rq, "--requirements", rp, "--proposal", pp],{capture_output:true,text:true}));
return [r.returncode, r.stdout];
}
([rc, out]=run_req("SFR-001\nSFR-002", "SFR-001은 대응한다. SFR-002도 대응한다."));
check("req_coverage: full coverage exits 0", (isDeepStrictEqual(rc,0)), ("exit=" + pyStr(rc)));
([rc, out]=run_req("SFR-001\nSFR-002", "SFR-001만 대응한다."));
check("req_coverage: missing coverage exits 1", ((value:any)=>truth(value)?((contains(out, "SFR-002"))):value)((isDeepStrictEqual(rc,1))), ("exit=" + pyStr(rc)));
([rc, _]=run_req("SFR-001", "SFR-0011 은 다른 ID 다."));
check("req_coverage: no prefix false positive (SFR-0011 != SFR-001)", (isDeepStrictEqual(rc,1)), ("exit=" + pyStr(rc)));
([rc, _]=[subprocessRun([process.execPath, rq, "--requirements", "/nonexistent", "--proposal", "/nonexistent"],{capture_output:true,text:true}).returncode, null]);
check("req_coverage: file errors exit 2", (isDeepStrictEqual(rc,2)), ("exit=" + pyStr(rc)));
removeTree(tmp, {ignore_errors: true});
(tmp=temporaryDirectory());
(cand_path=join(tmp, "c.json"));
(det_path=join(tmp, "d.json"));
section(check, results, "[en] lint: valid EN taxonomy passes", "[en] lint: missing surface FAIL", "[en] prescan: all metaphors EN-25–31 trigger", "[en] prescan: physical EN-25 (anvil) candidate identified by content", "[en] prescan: \\b boundary prevents heavyset false positives", "[en] reconcile: all candidates resolved passes", "[en] reconcile: poison (unresolved) FAIL", "[en] reconcile: hash mismatch FAIL", "[en] reconcile: keep without evidence FAIL", "[en] parser: surface/metric aliases and Korean surface fields recognized together", "[en] COMPUTED: EN-13 triggers and missing finding FAIL", "[en] prescan: EN-17 detects runtime-generated emoji").run(()=>{([_, errs]=lint_taxonomy.lint(EN_TAXONOMY));
check("[en] lint: valid EN taxonomy passes", !truth(errs), (pyStr(length(errs)) + " errors"));
{const f=fileHandle(EN_TAXONOMY,"r");(txt=f.read());}
(corrupt=join(tmp, "corrupt.md"));
{const f=fileHandle(corrupt,"w");f.write(subOnce("- surface: `\\(\\?i\\)\\\\b\\(heavy\\|heavyweight\\|lightweight\\)\\\\b`\\n", "", txt));}
([_, cerrs]=lint_taxonomy.lint(corrupt));
check("[en] lint: missing surface FAIL", truth(cerrs), (pyStr(length(cerrs)) + " detected"));
(cand=prescan.build_candidates(EN_GOLD, EN_TAXONOMY));
{const f=fileHandle(cand_path,"w");f.write(JSON.stringify(cand));}
(rules_hit=new Set(Array.from(at(cand, "candidates")).map((c: any) => (at(c, "rule_id")))));
(metaphor=new Set(Array.from(range(7).map(i=>i+25)).map((n: any) => (("EN-" + pyStr(n))))));
check("[en] prescan: all metaphors EN-25–31 trigger", (compare(metaphor,rules_hit,"<=")), ("missing " + pyStr(sorted(new Set([...metaphor].filter(value=>!rules_hit.has(value)))))));
(gold_text=normalize(readFileSync(EN_GOLD,"utf8")));
(phys=gold_text.indexOf("heavy anvil"));
(keep_ids=new Set(Array.from(at(cand, "candidates")).filter((c: any) => truth(((value:any)=>truth(value)?(isDeepStrictEqual(at(c, "start"),phys)):value)((isDeepStrictEqual(at(c, "rule_id"),"EN-25"))))).map((c: any) => (at(c, "candidate_id")))));
check("[en] prescan: physical EN-25 (anvil) candidate identified by content", truth(keep_ids), (truth(keep_ids) ? "" : "gold 'heavy anvil' match failed; cannot verify keep path"));
(binp=join(tmp, "b.txt"));
{const f=fileHandle(binp,"w");f.write("A monkey with heavyset build crucially delved.");}
(bcand=prescan.build_candidates(binp, EN_TAXONOMY));
(bad=Array.from(at(bcand, "candidates")).filter((c: any) => truth(((contains(["EN-25"], at(c, "rule_id")))))).map((c: any) => (at(c, "text_span"))));
check("[en] prescan: \\b boundary prevents heavyset false positives", !truth(bad), ("false positives " + pyStr(bad)));
(det=build_detection(cand,keep_ids));
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det));}
(r=reconcile.reconcile(cand_path, det_path, EN_TAXONOMY, EN_GOLD));
check("[en] reconcile: all candidates resolved passes", !truth(at(r, "failures")), pyStr(slice(at(r, "failures"), 0, 1)));
for (let [flag, key, label] of [["poison", "unresolved", "poison (unresolved) FAIL"], ["bad_hash", "hash", "hash mismatch FAIL"]]) {
(det2=build_detection(cand,keep_ids,{[flag]:true}));
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det2));}
(r=reconcile.reconcile(cand_path, det_path, EN_TAXONOMY, EN_GOLD));
check(("[en] reconcile: " + pyStr(label)), (Array.from(at(r, "failures")).map((x: any) => (((contains(x, key)))))).some((value:any)=>truth(value)));
}
(det3=build_detection(cand,keep_ids));
for (let k of at(det3, "kept")) {
delete k.evidence;
}
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(det3));}
(r=reconcile.reconcile(cand_path, det_path, EN_TAXONOMY, EN_GOLD));
check("[en] reconcile: keep without evidence FAIL", ((value:any)=>truth(value)?(Array.from(at(r, "failures")).map((x: any) => (((contains(x, "keep evidence")))))).some((value:any)=>truth(value)):value)(truth(at(det3, "kept"))));
(alias=join(tmp, "alias.md"));
{const f=fileHandle(alias,"w");f.write("# alias v1.0\n\n### AA-1. x [S2]\n- class: ANCHORED\n- surface: `foo`\n\n### AA-2. y [S2]\n- class: ANCHORED\n- 표층형: `bar`\n\n### AA-3. z [S2]\n- class: COMPUTED\n- metric: em_dash_count > 3\n");}
(p=parse_taxonomy(alias));
(ok=((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(at(at(at(p, "rules"), "AA-3"), "metric"),"em_dash_count > 3")):value)((isDeepStrictEqual(at(at(at(p, "rules"), "AA-2"), "surface"),"bar"))):value)((isDeepStrictEqual(at(at(at(p, "rules"), "AA-1"), "surface"),"foo"))));
check("[en] parser: surface/metric aliases and Korean surface fields recognized together", ok);
(cinp=join(tmp, "emdash.txt"));
{const f=fileHandle(cinp,"w");f.write((("A" + " — x".repeat(4)) + "."));}
(ccand=prescan.build_candidates(cinp, EN_TAXONOMY));
(_rules=(at(ccand, "meta")["computed_rules"] ?? {}));
if(truth(((!contains(_rules, "EN-13"))))) {
check("[en] taxonomy contains COMPUTED rule EN-13", false, ("computed_rules " + pyStr(length(_rules))));
}
(triggered=((_rules["EN-13"] ?? {})["triggered"] ?? false));
(ccand_path=join(tmp, "cc.json"));
{const f=fileHandle(ccand_path,"w");f.write(JSON.stringify(ccand));}
(bad_det={"meta": {"taxonomy_version": at(at(ccand, "meta"), "taxonomy_version"), "taxonomy_hash": at(at(ccand, "meta"), "taxonomy_hash")}, "findings": [], "kept": []});
{const f=fileHandle(det_path,"w");f.write(JSON.stringify(bad_det));}
(r=reconcile.reconcile(ccand_path, det_path, EN_TAXONOMY, cinp));
check("[en] COMPUTED: EN-13 triggers and missing finding FAIL", ((value:any)=>truth(value)?(Array.from(at(r, "failures")).map((x: any) => (((contains(x, "COMPUTED")))))).some((value:any)=>truth(value)):value)(triggered));
(einp=join(tmp, "emoji.txt"));
{const f=fileHandle(einp,"w");f.write((("The product launches in Q3 " + String.fromCodePoint(128640)) + " and users love it."));}
(ecand=prescan.build_candidates(einp, EN_TAXONOMY));
check("[en] prescan: EN-17 detects runtime-generated emoji", (Array.from(at(ecand, "candidates")).map((c: any) => ((isDeepStrictEqual(at(c, "rule_id"),"EN-17"))))).some((value:any)=>truth(value)));});
removeTree(tmp, {ignore_errors: true});
{const _f=fileHandle(join(ROOT, "SKILL.md"),"r");(sk=_f.read());}
(modes=findall("(?m)^- \\*\\*(general|procurement|proposal|english|technical-clarity)\\*\\*:", sk));
check("SKILL.md: all five mode branches exist", (isDeepStrictEqual(length(new Set(modes)),5)), pyStr(sorted(new Set(modes))));
for (let [mode, ref] of [["general", "pipeline-general.md"], ["procurement", "pipeline-procurement.md"], ["proposal", "pipeline-proposal.md"], ["english", "en-body.md"], ["technical-clarity", "asd-ste100.md"]]) {
(m=search(("(?m)^- \\*\\*" + pyStr(mode) + "\\*\\*:.*$"), sk));
check(("SKILL.md: " + pyStr(mode) + " points to " + pyStr(ref)), ((value:any)=>truth(value)?((contains(group(m, 0), ref))):value)(truth(m)));
check(("SKILL.md: " + pyStr(ref) + " exists"), existsSync(join(ROOT, "references", ref)));
}
check("technical clarity: former skill triggers route to Humanize", ["ASD-STE100", "Simplified Technical English", "STE로 써줘", "STE 준수 검사", "controlled technical English"].every(token => contains(sk, token)));
check("technical clarity: all former submodes survive", ["strict", "rule-aligned", "principles", "audit"].every(mode => contains(sk, `\`${mode}\``)));
check("technical clarity: strict status requires official rules and dictionary", contains(sk, "official Issue 9 rules and controlled dictionary available"));
check("technical clarity: unverified dictionary status survives", contains(sk, "ASD-STE100 rule-aligned; vocabulary unverified"));
check("technical clarity: non-English compliance boundary survives", contains(sk, "STE-informed rewrite; not ASD-STE100 compliant"));
check("technical clarity: audit remains findings-only", contains(sk, "Findings only; do not rewrite"));
check("technical clarity: immutable logic and safety fields survive", ["modality", "negation", "conditions", "safety consequence"].every(token => contains(sk, token)));
check("technical clarity: unknown actors are not invented", contains(sk, "Never invent an actor"));
check("technical clarity: candidate comparison repairs semantic drift", contains(sk, "Compare the candidate") && contains(sk, "logical scope") && contains(sk, "safety consequence"));
check("technical clarity: body-only output has no appended status", contains(sk, "do not append a status label"));
check("technical clarity: model recollection cannot establish compliance", contains(sk, "A model's recollection") && contains(sk, "cannot establish full compliance"));
check("technical clarity: certification and copyright boundaries survive", contains(sk, "Never describe output as certified by ASD") && contains(sk, "Do not package, republish"));
check("technical clarity: obsolete standalone skill is absent", !existsSync(join(SKILLS, "asd-ste100")));
{const dr=read(join(ROOT, "references", "direct.md")),asd=read(join(ROOT, "references", "asd-ste100.md"));
check("research report: report-writing requests route to research-report.md", contains(sk, "Select `research-report`") && contains(sk, "references/research-report.md") && contains(sk, "For `direct` and `research-report`"));
check("research report: itemized default excludes narrative reports", contains(dr, "narrative report, not a briefing report") && contains(dr, "Keep its paragraphs") && contains(dr, "references/research-report.md"));
check("research report: sentence splits keep conditions with their claims", contains(dr, "Keep a sentence whole when splitting") && !contains(dr, "Put one claim, fact, or instruction in each sentence.") && contains(asd, "Keep it whole when splitting"));
check("research report: technical-clarity contract splits only procedural sentences", !contains(sk, "one main proposition per sentence") && contains(sk, "Give each procedural sentence one action") && contains(sk, "no condition\nleaves its claim"));
{const rr=read(join(ROOT, "references", "research-report.md")),residue=["sre", "종합 판단", "조사 개요", "versus", "holmes", "datadog", "grafana", "pagerduty", "incident", "integration", "agent", "47", "65", "time to detect"].filter(token => contains(rr.toLowerCase(), token));
check("research report: reference stays domain-neutral", contains(rr, "domain-neutral") && residue.length===0, `residue ${residue.join(", ")}`);}
check("research report: ASD Korean profile lists only parallel items", contains(asd, "parallel requirements, choices, or risks") && contains(asd, "In descriptive prose, keep the evidence for one") && contains(asd, "references/research-report.md"));}
{const _f=fileHandle(join(ROOT, "references", "pipeline-procurement.md"),"r");(pp=_f.read());}
(m15=search("(?m)^## Phase 1\\.5:.*stop gate.*$", pp));
check("procurement: Phase 1.5 declared as a stop gate", ((m15 !== null)), (truth(m15) ? slice(group(m15, 0), 0, 50) : "heading missing"));
(_content_test=join(HERE, "test_content_contract.js"));
(_content_run=subprocessRun([({executable:process.execPath}).executable, _content_test],{cwd:ROOT,capture_output:true,text:true}));
check("native: SKILL.codex.md and actual content-contract battery", (_content_run.returncode===0&&/pass 13\b/.test(_content_run.stdout)), (truth(strip((_content_run.stdout + _content_run.stderr))) ? at(lines(strip((_content_run.stdout + _content_run.stderr))), -(1)) : ("exit=" + pyStr(_content_run.returncode))));
(sect="");
if(truth(m15)) {
(rest=slice(pp, pp.indexOf(group(m15, 0))));
(nxt=search("(?m)^## ", slice(rest, 3)));
(sect=(truth(nxt) ? slice(rest, 0, (nxt.index + 3)) : rest));
}
check("procurement: stop-gate section invokes req_coverage", ((contains(sect, "req_coverage.js"))), ("section of " + pyStr(length(sect)) + " characters"));
check("procurement: stop-gate section requires stopping on missing coverage", ((value:any)=>truth(value)?((contains(sect, "Exit 1"))):value)(((contains(sect, "Stop")))));
(SUBTESTS=[["test_register_axis.js", "references/register-axis.md", "Register-axis contract PASS"], ["test_e2_exemption.js", "references/ai-tell-taxonomy.md", "E-2 exemption contract PASS"], ["test_noslop_exemptions.js", "references/ai-tell-taxonomy.md", "3.9 exception contract PASS"], ["test_gaejosik_attribution.js", "references/gaejosik.md", "Fragment-style ownership contract PASS"], ["test_outcomes_schema.js", "outcomes.jsonl", "Field-outcome contract PASS"]]);
(empty_root=temporaryDirectory());
try {for (let [_name, _subject, _token] of SUBTESTS) {
(_path=join(HERE, _name));
(_r=subprocessRun([({executable:process.execPath}).executable, _path, ROOT],{capture_output:true,text:true}));
(_tail=lines(strip(((value:any)=>truth(value)?value:_r.stdout)(_r.stderr))));
check(("Auxiliary contract: " + pyStr(_name) + " passes on actual source (" + pyStr(_subject) + ")"), ((value:any)=>truth(value)?((contains(_r.stdout, _token))):value)((isDeepStrictEqual(_r.returncode,0))), (("rc=" + pyStr(_r.returncode) + " ") + (truth(_tail) ? slice(at(_tail, -(1)), 0, 90) : "no output")));
(_n=subprocessRun([({executable:process.execPath}).executable, _path, empty_root],{capture_output:true,text:true}));
check(("Auxiliary contract: " + pyStr(_name) + " fails closed with a missing target"), (!isDeepStrictEqual(_n.returncode,0)), ("rc=" + pyStr(_n.returncode) + " — passing without a target is not fail-closed"));
}
(MUTATIONS=[["test_register_axis.js", "references/register-axis.md", "lit", "### Case 5: ", "### Case5: ", "damage case 5 heading"], ["test_e2_exemption.js", "references/ai-tell-taxonomy.md", "re", "(?m)^(\\|\\s*Itemized body[^|]*\\|\\s*)Exempt(\\s*\\|)", "\\1Applies\\2", "change itemized-body table row from Exempt to Applies"], ["test_noslop_exemptions.js", "references/ai-tell-taxonomy.md", "lit", "proposals, official documents, or itemized writing", "official documents, or itemized writing", "remove proposals from 3.9 exclusion"], ["test_gaejosik_attribution.js", "references/gaejosik.md", "lit", "Ministry of\nthe Interior and Safety ordinance", "presidential decree", "legal hierarchy regression"], ["test_outcomes_schema.js", "outcomes.jsonl", "append", "{\"run_id\":\"zz\",\"사업\":\"x\",\"결과\":\"보류\",\"cat\":{}}\n", "", "add outcome outside three allowed values"]]);
(_mwork=temporaryDirectory());
try {(_mdst=join(_mwork, "humanize"));
cpSync(ROOT,_mdst,{recursive:true,filter:(path:string)=>!["__pycache__",".git"].includes(basename(path))&&!path.endsWith(".pyc")});
for (let [_nm, _rel, _kind, _a, _b, _desc] of MUTATIONS) {
(_tp=join(_mdst, _rel));
(_sub=join(HERE, _nm));
(_orig=readFileSync(_tp,"utf8"));
(_ctl=subprocessRun([({executable:process.execPath}).executable, _sub, _mdst],{capture_output:true,text:true}));
if(truth((isDeepStrictEqual(_kind,"lit")))) {
(_mut=replace(_orig, _a, _b));
} else {
if(truth((isDeepStrictEqual(_kind,"re")))) {
(_mut=sub(_a, _b, _orig));
} else {
(_mut=((rstrip(_orig, "\n") + "\n") + _a));
}
}
(_applied=(!isDeepStrictEqual(_mut,_orig)));
writeFileSync(_tp,_mut);
try {(_rm=subprocessRun([({executable:process.execPath}).executable, _sub, _mdst],{capture_output:true,text:true}));}finally{writeFileSync(_tp,_orig);}
check(("Auxiliary contract: " + pyStr(_nm) + " detects target damage (" + pyStr(_desc) + ")"), ((value:any)=>truth(value)?((value:any)=>truth(value)?(!isDeepStrictEqual(_rm.returncode,0)):value)(_applied):value)((isDeepStrictEqual(_ctl.returncode,0))), ("control_rc=" + pyStr(_ctl.returncode) + " mutation_applied=" + pyStr(_applied) + " mutation_rc=" + pyStr(_rm.returncode)));
}}finally{removeTree(_mwork, {ignore_errors: true});}
(AUDIT=join(SCRIPTS, "audit_measures.js"));
(TAX=join(ROOT, "references", "ai-tell-taxonomy.md"));
(_ra=subprocessRun([({executable:process.execPath}).executable, AUDIT, "--taxonomy", TAX],{capture_output:true,text:true}));
check("Measurement reaudit: no mismatches in actual taxonomy", ((value:any)=>truth(value)?((contains(_ra.stdout, "Mismatches: 0"))):value)((isDeepStrictEqual(_ra.returncode,0))), (("rc=" + pyStr(_ra.returncode) + " ") + slice(replace(strip(_ra.stdout), "\n", " / "), -(90))));
(_rj=subprocessRun([({executable:process.execPath}).executable, AUDIT, "--taxonomy", TAX, "--json"],{capture_output:true,text:true}));
try {(_rep=JSON.parse(_rj.stdout));}catch(error){(_rep=null);}
(_declared=length(findall("(?m)^-\\s*class:\\s*ANCHORED\\s*$", readFileSync(TAX,"utf8"))));
check("Measurement reaudit: declared count matches taxonomy ANCHORED annotations", ((value:any)=>truth(value)?((value:any)=>truth(value)?(isDeepStrictEqual(at(at(_rep, "measurable"), "ANCHORED"),_declared)):value)(((_rep !== null))):value)((compare(_declared,0,">"))), (("annotations " + pyStr(_declared) + " / reported ") + pyStr((truth(_rep) ? at(at(_rep, "measurable"), "ANCHORED") : "none"))));
(_dead=join(empty_root, "dead_pattern.md"));
{const f=fileHandle(_dead,"w");f.write("# 시험 분류 v9.9\n\n### Z-1. 시험 규칙\n- 예: 이 절의 어느 예문도 아래 표층형을 담지 않는다\n- class: ANCHORED\n- 표층형: `절대로나타나지않을문자열`\n");}
(_rd=subprocessRun([({executable:process.execPath}).executable, AUDIT, "--taxonomy", _dead, "--json"],{capture_output:true,text:true}));
try {(_kinds=Array.from(at(JSON.parse(_rd.stdout), "findings")).map((f: any) => (at(f, "kind"))));}catch(error){(_kinds=[]);}
check("Measurement reaudit: detects dead surfaces in corrupted copies", ((value:any)=>truth(value)?((contains(_kinds, "죽은표층형"))):value)((isDeepStrictEqual(_rd.returncode,1))), ("rc=" + pyStr(_rd.returncode) + " kinds=" + pyStr(_kinds)));
(_ov=join(empty_root, "overlap.md"));
{const f=fileHandle(_ov,"w");f.write("# 시험 분류 v9.9\n\n### Z-1. 시험 규칙 하나\n- 예: 그런 것이다 라고 끝난다\n- class: ANCHORED\n- 표층형: `것이다`\n\n### Z-2. 시험 규칙 둘\n- 예: 그런 것이다 라고 끝난다\n- class: ANCHORED\n- 표층형: `그런 것이다`\n");}
(_rv=subprocessRun([({executable:process.execPath}).executable, AUDIT, "--taxonomy", _ov, "--json"],{capture_output:true,text:true}));
try {(_kinds2=Array.from(at(JSON.parse(_rv.stdout), "findings")).map((f: any) => (at(f, "kind"))));}catch(error){(_kinds2=[]);}
check("Measurement reaudit: detects surface overlaps between rules", ((contains(_kinds2, "표층형겹침"))), ("kinds=" + pyStr(_kinds2)));
(AUDIT_AXES=[["계측밖필드", "### Z-1. 시험 규칙\n- 예: 그런 것이다 라고 끝난다\n- class: HOLISTIC\n- 표층형: `것이다`\n"], ["도달불가대안", "### Z-1. 시험 규칙\n- 예: 그런 것이다 라고 끝난다\n- class: ANCHORED\n- 표층형: `것이|것이다`\n"], ["면제사유부실", "### Z-1. 시험 규칙\n- 예: 아무 예문도 아니다\n- class: ANCHORED\n- 표층형: `절대로나타나지않을문자열`\n- 재감사: 짧음\n"], ["미측정지표", "### Z-1. 시험 규칙\n- 예: 아무 예문\n- class: COMPUTED\n- 지표: 없는지표 > 0.5\n"]]);
for (let [_axis, _bodytxt] of AUDIT_AXES) {
(_fp=join(empty_root, ("axis_" + pyStr(_axis) + ".md")));
{const f=fileHandle(_fp,"w");f.write(("# 시험 분류 v9.9\n\n" + _bodytxt));}
(_ax=subprocessRun([({executable:process.execPath}).executable, AUDIT, "--taxonomy", _fp, "--json"],{capture_output:true,text:true}));
try {(_ak=Array.from(at(JSON.parse(_ax.stdout), "findings")).map((f: any) => (at(f, "kind"))));}catch(error){(_ak=[]);}
check(("Measurement reaudit: detects " + pyStr(_axis) + " in a corrupted copy"), ((value:any)=>truth(value)?((contains(_ak, _axis))):value)((isDeepStrictEqual(_ax.returncode,1))), ("rc=" + pyStr(_ax.returncode) + " kinds=" + pyStr(_ak)));
}}finally{removeTree(empty_root, {ignore_errors: true});}
(REF_CONTRACTS=[["asd-ste100.md", "Adaptable STE baseline and Korean boundary", ["not as a mandatory style filter.", "Do not apply the 20-word and 25-word English limits", "controlled dictionary"], 7215], ["ai-tell-taxonomy.md", "A–J categories, rule classes, and severity criteria", ["Rule classes", "Severity", "A-1", "Translationese", "S1", "S2"], 45805], ["pipeline-procurement.md", "Phase 1.5 requirement-traceability stop gate", ["Phase 1.5", "stop gate", "traceability", "Phase 3"], 5324], ["caption-headnouns.md", "Closed head-noun set and forbidden endings", ["매트릭스", "로드맵", "내역", "차별점", "Disallowed endings outside the set"], 4012], ["empirical-validation.md", "Log-likelihood test design and corpus cutoff date", ["로그우도", "3.84", "2022-01-01", "Dunning"], 7116], ["direct.md", "Default one-pass editing contract", ["Selection", "One-pass boundary", "Never invent a fact", "Return only the edited artifact"], 7000], ["clean-rewrite.md", "Bounded inventory and exact-target conditional-write gate", ["Use two independently evidenced\nsearches", "Commit a verified candidate only through a trusted conditional-write adapter", "do not write, merge, or roll back"], 2700], ["debloat.md", "Claim-preserving compression and cross-artifact boundary", ["load-bearing claims and rules", "cross-artifact duplication as a separate source-of-truth task", "A lower word count\ndoes not prove improvement."], 1400], ["reorder.md", "Byte-exact move-only permutation and multiplicity checks", ["multiset of unit identities", "Apply one stable permutation", "Move the whole\nunit byte-for-byte"], 1800], ["research-report.md", "Narrative report structure, comparison units, and evidence scope", ["| Itemized briefing |", "Do not judge the subject's maturity,", "Different levels of one hierarchy are different units of comparison", "Distinguish `읽은 범위에서 찾지 못했다` from `없다`.", "govern report structure"], 9000],["en-body.md", "English-mode pattern body", ["Undue Emphasis", "Promotional", "soulless"], 27154], ["en-taxonomy.md", "EN rule definitions", ["EN-1", "surface"], 9887], ["pipeline-general.md", "Phase 3.5 structural convergence gate and abort threshold", ["Phase 3.5", "over_polish_warning", "Exit 2", "50%"], 7322], ["pipeline-proposal.md", "Przeworski framework and review modes", ["Przeworski", "full-review", "section-review", "targeted"], 5730], ["procurement-playbook.md", "Change-rate thresholds and replacement recipe format", ["25%", "40%", "[전]", "[후]", "K-1"], 6931], ["procurement-taxonomy.md", "All K–O categories and severity", ["K-1", "K-5", "L.", "S1", "S2"], 14603], ["rewriting-playbook.md", "Prime directives and change-rate SSOT", ["verify_gates.js", "change_rate", "50%", "Remove only; no new tells"], 10070], ["register-axis.md", "Three registers, classifiers, and falsification conditions", ["Different verdicts on identical text in different registers are expected.", "If\nautomatic register classification falls below 90% accuracy on a paragraph sample,\nthis axis is impractical.", "Exemption does not delete the rules."], 4321], ["register-invariants.md", "Mutable/immutable boundary and four-step delta audit", ["A statement alone\ncannot enforce that principle; it needs an audit procedure.", "If a delta touches any immutable item, roll back that edit.", "Neither discard nor pass them; passing an unassignable\n   change would defeat the audit."], 2740], ["gaejosik.md", "Level thresholds, scope limits, and legal hierarchy", ["These medians describe practice in the 15-report sample, not regulations.", "The enforcement rule is a **Ministry of\nthe Interior and Safety ordinance**, not a presidential decree.", "This file alone owns the fragment-style thresholds."], 3115], ["improvement-protocol.md", "Blind pair comparisons and promotion procedure", ["Exclude pairs with broken blinding and retain the reason.", "Make no judgment with fewer than 5 valid pairs.", "The re-audit measures gaps between declarations and observations. It is not a\nrule-passing tool."], 3873], ["code-space.md", "Code-namespace separation and provisional status", ["**Unprefixed `[A-Z]-\\d+` codes have an unresolved namespace.**", "A code absent from the allocation table has not been issued.", "Prefixes resolve identifier collisions. Rules can still issue opposite decisions\non the same paragraph: giving them different names does not resolve that conflict."], 2002], ["taxonomy-codespace.md", "Namespace allocations and counting criteria", ["A code absent from the\nallocation table has not been issued.", "Count rule headings, not body citations,", "The density ledger's `C-14` and the taxonomy's `C-14` refer to different things."], 1866]]);
check_ref_contracts(check, ROOT, REF_CONTRACTS);
(crit_path=join(dirname(dirname(ROOT)), "evals", "regression", "humanize-taxonomy-recall", "graders", "criteria.md"));
check("eval: discrimination-case criteria exist", isfile(crit_path));
if(truth(isfile(crit_path))) {
(crit=readFileSync(crit_path,"utf8"));
(tax_p=readFileSync(join(ROOT, "references", "procurement-taxonomy.md"),"utf8"));
(real=Object.fromEntries(Array.from("KLMNO").map((L: any) => ([L, length(new Set(Array.from(findall(("\\b(" + pyStr(L) + "-\\d+)\\b"), tax_p)).map((i: any) => (i))))]))));
(declared=Object.fromEntries(findall("(?m)^\\| ([K-O]) \\|.*\\| (\\d+) \\|\\s*$", crit)));
check("eval: criteria item counts match actual taxonomy", (isDeepStrictEqual(Object.fromEntries(Array.from(Object.entries(declared)).map(([k, v]: any) => ([k, Number(v)]))),real)), ("criteria " + pyStr(declared) + " / actual " + pyStr(real)));
}
check_skill_body(check, ROOT, {needles: ["## Default direct execution", "return only the\nedited artifact", "Semantic preservation takes precedence.", "Warn or stop when the edit-rate threshold is exceeded;", "Identify language\nbefore genre:", "Preserve genre;"], floor: 3017});
check_upstream_parity(check);
check_no_constant_assertions(check, SUITE_FILE);
(live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
for (const [file, needles] of [["NOTICE", ["epoko77-ai/im-not-ai", "jkf87/noslop-ko", "snflkd/fluent-korean", "chrisryugj/kordoc"]], ["LICENSE.im-not-ai", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]], ["LICENSE.noslop-ko", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]], ["LICENSE.fluent-korean", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]], ["LICENSE.kordoc", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"NOTICE": 1, "LICENSE.im-not-ai": 1, "LICENSE.noslop-ko": 1, "LICENSE.fluent-korean": 1, "LICENSE.kordoc": 1, "UPSTREAM.sha256": 3, "SKILL.md": 29, "SKILL.codex.md": 1, "references/asd-ste100.md": 5, "references/ai-tell-taxonomy.md": 17, "references/direct.md": 6, "references/clean-rewrite.md": 3, "references/debloat.md": 3, "references/reorder.md": 3, "references/research-report.md": 5, "references/caption-headnouns.md": 3, "references/empirical-validation.md": 3, "references/en-body.md": 3, "references/en-taxonomy.md": 11, "references/pipeline-general.md": 3, "references/pipeline-procurement.md": 7, "references/pipeline-proposal.md": 3, "references/procurement-playbook.md": 3, "references/procurement-taxonomy.md": 9, "references/rewriting-playbook.md": 3, "references/register-axis.md": 5, "references/register-invariants.md": 3, "references/gaejosik.md": 5, "references/improvement-protocol.md": 3, "references/code-space.md": 3, "references/taxonomy-codespace.md": 3}, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 53, extra_strip: ["references/clean-rewrite.md", "references/debloat.md", "references/pipeline-general.md", "references/pipeline-procurement.md", "references/pipeline-proposal.md", "references/en-body.md", "references/reorder.md"], live_ran: live_ran});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/lint_taxonomy.js": 25, "scripts/metrics_v1.js": 38, "scripts/metrics_v2.js": 39, "scripts/metrics.js": 34, "scripts/prescan.js": 20, "scripts/reconcile.js": 14, "scripts/audit_measures.js": 8, "scripts/req_coverage.js": 3, "scripts/taxonomy_rules.js": 35, "scripts/verify_gates.js": 4, "tests/test_register_axis.js": 3, "tests/test_e2_exemption.js": 3, "tests/test_noslop_exemptions.js": 3, "tests/test_gaejosik_attribution.js": 3, "tests/test_outcomes_schema.js": 3, "scripts/golden_checks.js": 12, "scripts/baseline.json": 4, "scripts/baseline_v2.json": 2}, live_ran: live_ran});
(_bl_dir=join(ROOT, "scripts"));
try {(_bl=JSON.parse(readFileSync(join(_bl_dir, "baseline.json"),"utf8")));}catch(error){(_bl={});}
check("Baseline: baseline.json parses as JSON", truth(_bl));
check("Baseline: version exists to identify measurement provenance", ((value:any)=>truth(value)?truth((_bl["source"] ?? null)):value)(truth((_bl["version"] ?? null))), ("version=" + pyStr((_bl["version"] ?? null))));
(_genres=((value:any)=>truth(value)?value:{})((_bl["genres"] ?? null)));
check("Baseline: six genres exist (essay/poetry/abstract/news/qa/blog)", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(_genres, "blog"))):value)(((contains(_genres, "essay")))):value)((isDeepStrictEqual(length(_genres),6))), (pyStr(sorted(_genres))));
check("Baseline: z-score decision thresholds declared", truth((((value:any)=>truth(value)?value:{})((_bl["z_score_thresholds"] ?? null))["high_risk"] ?? null)));
try {(_bl2=JSON.parse(readFileSync(join(_bl_dir, "baseline_v2.json"),"utf8")));}catch(error){(_bl2={});}
check("Baseline: baseline_v2.json parses as JSON", truth(_bl2));
check("Baseline: v2 placeholder flags preserved (declared invariant)", (compare(count(JSON.stringify(_bl2,null,1), "\"_placeholder\": true"),70,">=")), (pyStr(count(JSON.stringify(_bl2,null,1), "\"_placeholder\": true")) + "개"));
check_total(check, results, 226);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();

function subOnce(pattern:string,replacement:string,text:string):string{return text.replace(new RegExp(pattern),replacement);}
