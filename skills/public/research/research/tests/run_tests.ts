/** Research owning contracts; deployed Node checkers execute against isolated fixtures. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runProcess, expand } from '../../../../../runtime/os.js';
import { check_no_constant_assertions, check_total, check_skill_body, check_ref_contracts, split_frontmatter, check_body_deletion, check_contract_coverage, check_script_contracts, type Result } from '../../../../_suite_lib.js';
import { truth, length, contains, unique, sorted, repr, at, slice, strip, lstrip, rstrip, split, lines, count, starts, ends, lower, joinText, replace, findall, finditer, search, match, group, sub, isdir, isinstance, temporaryDirectory, removeTree } from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SCRIPTS=join(ROOT,'scripts'),CITE=join(SCRIPTS,'cite_check.js'),COV=join(SCRIPTS,'coverage_matrix.js');
const results:Result[]=[];
function check(name:string,ok:boolean,detail=''):void{results.push([name,ok,detail]);console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
const read=(p:string)=>readFileSync(p,'utf8');
function run(script:string,...args:string[]):[number,string]{const r=runProcess(process.execPath,[script,...args]);return [r.status??-1,r.stdout+r.stderr];}
function main():number {
let CRITICS:any, ENSURE:any, NAME:any, _:any, _OFF:any, _crit:any, _kr2:any, _pairs_txt:any, _tp:any, ax:any, bad:any, banned:any, budgets:any, c:any, cell:any, cells:any, cite_md:any, cite_src:any, contract:any, f:any, fm:any, good:any, grades:any, hits:any, key:any, kind:any, kr:any, l:any, line:any, listed:any, ln:any, m:any, missing:any, models:any, n:any, n_default:any, n_pairs:any, n_tier:any, notice:any, ok:any, opt:any, out:any, out2:any, pairs_out:any, parse_err:any, passed:any, prof:any, prop:any, r:any, raw_contract:any, rc:any, rc2:any, rc_g:any, referred:any, req:any, req_axes:any, row:any, rows:any, self_row:any, skill:any, skill_all:any, skills_dir:any, src:any, src_en:any, tier:any, tmp:any, up:any, up_row:any, v:any, why:any;
(skill_all=read(join(ROOT, "SKILL.md")));
([fm, skill]=split_frontmatter(skill_all));
(notice=read(join(ROOT, "NOTICE")));
(cite_md=read(join(ROOT, "references", "cite-check.md")));
(kr=read(join(ROOT, "references", "kr-sources.md")));
(tier=read(join(ROOT, "references", "tier-profile.md")));
(tmp=temporaryDirectory());
(bad=join(tmp, "bad.md"));
writeFileSync(bad, "# 보고서\n\n## 요약\n\n시장은 200조다 [1]. 비중이 늘었다 [2]. 전환이 동인이다 [7].\n\n## 출처\n\n[1] 조달청 통계 — https://pps.go.kr/x\n[2] 진흥원 보고서\n[3] 미사용 — https://example.org\n");
([rc, out]=run(CITE, bad));
check("Self-contained: cite_check rejects an invalid report", (rc === 1), ("rc=" + repr(rc)));
for (const [kind, why] of [["MISSING", "Citation absent from source list"], ["UNUSED", "Uncited source"], ["UNRESOLVED", "Source without identifier"]]) {
check(("Self-contained: cite_check detects " + repr(kind) + " (" + repr(why) + ")"), (contains(out, ("[" + repr(kind) + "]"))));
}
(good=join(tmp, "good.md"));
writeFileSync(good, "# 보고서\n\n## 요약\n\n시장은 200조다 [1]. 비중이 늘었다 [2].\n\n전환이 동인이다 [3]. 규제가 변수다 [4].\n\n## 출처\n\n[1] 조달청 통계 — https://pps.go.kr/x\n[2] 진흥원 보고서 — https://nipa.kr/y\n[3] 클라우드 백서 — https://example.org/z\n[4] 법령 — https://law.go.kr/w\n");
([rc_g, _]=run(CITE, good));
check("Self-contained: cite_check accepts a valid report (no over-detection)", (rc_g === 0), ("rc=" + repr(rc_g)));
(pairs_out=join(tmp, "p.jsonl"));
run(CITE, good, "--pairs", pairs_out);
(_pairs_txt=(truth(existsSync(pairs_out)) ? read(pairs_out) : ""));
(n_pairs=length(Array.from(lines(_pairs_txt)).filter((l: any) => truth(strip(l))).map((l: any) => l)));
check("Self-contained: cite_check exports every citation without sampling", (n_pairs === 4), (repr(n_pairs) + " pairs / 4 citations; fewer pairs indicate introduced sampling"));
(req=join(tmp, "req.txt"));
writeFileSync(req, "REQ-001  인증은 SSO 를 지원한다\nREQ-002  로그 1년 보관\nREQ-003  이중화\n");
(prop=join(tmp, "prop.md"));
writeFileSync(prop, (("# 제안\n\nREQ-001 " + "가".repeat(300)) + "\n\nREQ-002 짧음.\n\nREQ-009 목록에 없음.\n"));
([rc2, out2]=run(COV, "--req", req, "--report", prop));
check("Self-contained: coverage_matrix rejects an invalid deliverable", (rc2 === 1), ("rc=" + repr(rc2)));
for (const [kind, why] of [["MISSING", "Missing requirement"], ["THIN", "Response too short"], ["ORPHAN", "ID absent from list"]]) {
check(("Self-contained: coverage_matrix detects " + repr(kind) + " (" + repr(why) + ")"), (contains(out2, ("[" + repr(kind) + "]"))));
}
// Evidence needs: the opt-in typed checks through the real coverage_matrix CLI, bound to a requirements file.
{
const evLog=join(tmp,"ev.log"), evReq=join(tmp,"ev-req.txt"), evRep=join(tmp,"ev-report.md"), evNeeds=join(tmp,"ev-needs.json");
const evText="INC-1 database failover cost 3000 won\nINC-2 cache outage cost 5500 won\n";
writeFileSync(evLog, evText);
writeFileSync(evReq, "REQ-001  Every incident is listed\nREQ-002  Total the cost\n");
writeFileSync(evRep, "# 보고\n\nREQ-001 목록: 총 2건\n- INC-1 database failover\n- INC-2 cache outage\n\nREQ-002 합계 8,500\n- INC-1 3,000\n- INC-2 5,500\n\n## 출처\n\n[1] 로그 — https://example.org/log\n");
const sha=(v:string)=>createHash("sha256").update(v).digest("hex"), folded=(v:string)=>sha(v.normalize("NFKC").replace(/\s+/gu," ").trim());
const boundary={source:"S1",linePrefix:"INC-"};
const items=(withValue:boolean)=>[["INC-1","database failover","3000"],["INC-2","cache outage","5500"]].map(([id,what,value])=>({id,source:"S1",quote:withValue?`${id} ${what} cost ${value}`:`${id} ${what}`,...(withValue?{value}:{})}));
const manifest=():any=>({schema:"jstack-evidence-needs/1",sources:{S1:{path:evLog,sha256:sha(evText)}},needs:[
  {id:"N1",type:"enumerate",requirement:"REQ-001",requirementSha256:folded("Every incident is listed"),boundary,items:items(false)},
  {id:"N2",type:"compute",operation:"sum",requirement:"REQ-002",requirementSha256:folded("Total the cost"),claimed:"8500",reportPrefix:"합계",boundary,items:items(true)}]});
const evRun=(edit:(m:any)=>void=()=>{},...extra:string[]):[number,string]=>{const m=manifest();edit(m);writeFileSync(evNeeds,JSON.stringify(m));return run(COV,"--req",evReq,"--report",evRep,"--needs",evNeeds,"--min-chars","10",...extra);};
let evOut:string; let evRc:number;
([evRc, evOut]=evRun());
check("Evidence needs: a consistent exhaustive set and exact sum pass through the CLI", (evRc === 0 && contains(evOut, "mechanical result: consistent")), ("rc=" + repr(evRc) + " " + evOut.slice(-200)));
check("Evidence needs: a pass says it does not prove source completeness", contains(evOut, "does not show that the source is the whole population"));
for (const [label, kind, edit] of [
  ["an omitted boundary item", "OMITTED", (m:any)=>{m.needs[0].items.pop();}],
  ["a duplicate item", "DUPLICATE_ITEM", (m:any)=>{m.needs[0].items.push({...m.needs[0].items[0]});}],
  ["a model-supplied total that differs from the items", "ARITHMETIC_MISMATCH", (m:any)=>{m.needs[1].claimed="9000";}],
  ["an empty needs list", "EMPTY_EVIDENCE", (m:any)=>{m.needs=[];}],
  ["an item without evidence", "EMPTY_EVIDENCE", (m:any)=>{m.needs[0].items=[];}],
  ["an invented quote", "QUOTE_NOT_SUPPORTED", (m:any)=>{m.needs[0].items[1].quote="INC-2 cache meltdown";}],
  ["a value from another row", "VALUE_NOT_IN_QUOTE", (m:any)=>{m.needs[1].items[0].value="5500";}],
  ["a requirement changed since the manifest", "STALE_REQUIREMENT", (m:any)=>{m.needs[0].requirementSha256=folded("Every incident is listed before October");}],
  ["a requirement with no need", "NO_NEED", (m:any)=>{m.needs.pop();}],
  ["a requirement missing from the list", "UNKNOWN_REQUIREMENT", (m:any)=>{m.needs[0].requirement="REQ-009";}],
  ["a missing boundary", "UNMEASURED", (m:any)=>{delete m.needs[0].boundary;}],
  ["a judge need", "MANUAL", (m:any)=>{m.needs.push({id:"N9",type:"judge",requirement:"REQ-002",requirementSha256:folded("Total the cost")});}],
] as [string,string,(m:any)=>void][]) {
  const [rcN, outN]=evRun(edit);
  check(("Evidence needs: " + label + " fails closed as " + repr(kind)), (rcN === 1 && contains(outN, "[" + kind + "]")), ("rc=" + repr(rcN)));
}
writeFileSync(evLog, evText + "INC-3 late arrival cost 1 won\n");
([evRc, evOut]=run(COV,"--req",evReq,"--report",evRep,"--needs",evNeeds,"--min-chars","10"));
check("Evidence needs: a source changed after its hash was recorded cannot pass", (evRc === 1 && contains(evOut, "[STALE_SOURCE]")), ("rc=" + repr(evRc)));
writeFileSync(evLog, evText);
check("Evidence needs: an empty --cover selection is refused", (evRun(()=>{}, "--cover", "")[0] === 2));
check("Evidence needs: a narrowed --cover names what stays outside the check", contains(evRun((m:any)=>{m.needs.pop();}, "--cover", "REQ-001")[1], "outside this check: REQ-002"));
check("Evidence needs: --pairs is refused with --needs so inputs are never overwritten", (evRun(()=>{}, "--pairs", join(tmp,"ev-pairs.jsonl"))[0] === 2 && !existsSync(join(tmp,"ev-pairs.jsonl"))));
check("Evidence needs: a JSON number claim is refused", (() => { const [rcN, outN]=evRun((m:any)=>{m.needs[1].claimed=8500;}); return rcN === 1 && contains(outN, "[INVALID_NEED]"); })());
check("Evidence needs: typed options require --needs", (run(COV,"--req",evReq,"--report",evRep,"--task","t")[0] === 2));
// A numeric span is read whole: a prefix of `1,23` or `3e3` never grounds a value; grouped, decimal and negative values still pass.
const numRun=(row:string,value:string,quoteEnd:string=row,reportBody?:string,prefix:string="합계"):[number,string]=>{
  const log=`ROW-A cost ${row} dollars\n`, numLog=join(tmp,"num.log"), numReq=join(tmp,"num-req.txt"), numRep=join(tmp,"num-report.md"), numNeeds=join(tmp,"num-needs.json");
  writeFileSync(numLog, log); writeFileSync(numReq, "REQ-001  Total the cost\n");
  writeFileSync(numRep, `# 보고\n\nREQ-001 ${reportBody ?? `합계 ${value}\n- ROW-A ${value}`}\n\n## 출처\n\n[1] x — https://example.org\n`);
  writeFileSync(numNeeds, JSON.stringify({schema:"jstack-evidence-needs/1",sources:{S1:{path:numLog,sha256:sha(log)}},needs:[{id:"N1",type:"compute",operation:"sum",requirement:"REQ-001",requirementSha256:folded("Total the cost"),claimed:value,...(prefix?{reportPrefix:prefix}:{}),boundary:{source:"S1",linePrefix:"ROW-"},items:[{id:"ROW-A",source:"S1",quote:`ROW-A cost ${quoteEnd}`,value}]}]}));
  return run(COV,"--req",numReq,"--report",numRep,"--needs",numNeeds,"--min-chars","10");
};
for (const [row, value] of [["1,23","1"],["3e3","3"],["1.2.3","1"],["1_000","1"]]) {
  const [rcN, outN]=numRun(row, value);
  check(("Evidence needs: number notation " + repr(row) + " is never read as its prefix " + repr(value)), (rcN === 1 && contains(outN, "[MALFORMED_NUMBER]")), ("rc=" + repr(rcN)));
}
for (const [row, quoteEnd, value] of [["3000","3","3"],["1,23","1","1"],["3000","000","0"],["-3000","3000","3000"]]) {
  const [rcN, outN]=numRun(row, value, quoteEnd);
  check(("Evidence needs: a quote ending " + repr(quoteEnd) + " inside source number " + repr(row) + " is refused"), (rcN === 1 && contains(outN, "[QUOTE_NOT_SUPPORTED]")), ("rc=" + repr(rcN)));
}
for (const [row, value] of [["3000","3000"],["1,234","1,234"],["0.5","0.5"],["-3.5","-3.5"]]) {
  const [rcN, outN]=numRun(row, value);
  check(("Evidence needs: valid control " + repr(row) + " passes"), (rcN === 0 && contains(outN, "mechanical result: consistent")), ("rc=" + repr(rcN) + " " + outN.slice(-160)));
}
// A total is read from one declared report line; item rows and other labelled numbers never stand in for it.
for (const [label, kind, body, prefix] of [
  ["a wrong Total beside a component row and a Budget line", "AGGREGATE_MISMATCH", "ledger\n- ROW-A 7\nBudget 7\nTotal cost 99", "Total cost"],
  ["only the component row repeating the claimed value", "NOT_IN_REPORT", "ledger\n- ROW-A 7\nBudget 7", "Total cost"],
  ["a missing reportPrefix", "PREFIX_MISSING", "ledger\n- ROW-A 7\nTotal cost 7", ""],
] as [string,string,string,string][]) {
  const [rcN, outN]=numRun("7","7","7",body,prefix);
  check(("Evidence needs: " + label + " fails closed as " + repr(kind)), (rcN === 1 && contains(outN, "[" + kind + "]")), ("rc=" + repr(rcN)));
}
{ const [rcN, outN]=numRun("7","7","7","ledger\n- ROW-A 7\nBudget 99\nTotal cost 7","Total cost");
  check("Evidence needs: the declared Total line passes beside other labelled numbers", (rcN === 0 && contains(outN, "mechanical result: consistent")), ("rc=" + repr(rcN) + " " + outN.slice(-120))); }
// Values and claims are exact JSON strings: blanks, structures and JSON numbers never ground a lookup.
const lkRun=(row:string,value:unknown,claimed:unknown):[number,string]=>{
  const log=`ROW-A cost ${row} dollars\n`, lkLog=join(tmp,"lk.log"), lkReq=join(tmp,"lk-req.txt"), lkRep=join(tmp,"lk-report.md"), lkNeeds=join(tmp,"lk-needs.json");
  writeFileSync(lkLog, log); writeFileSync(lkReq, "REQ-001  Look up the cost\n");
  writeFileSync(lkRep, `# 보고\n\nREQ-001 조회\n- ROW-A ${row}\n\n## 출처\n\n[1] x — https://example.org\n`);
  writeFileSync(lkNeeds, JSON.stringify({schema:"jstack-evidence-needs/1",sources:{S1:{path:lkLog,sha256:sha(log)}},needs:[{id:"N1",type:"lookup",requirement:"REQ-001",requirementSha256:folded("Look up the cost"),claimed,items:[{id:"ROW-A",source:"S1",quote:`ROW-A cost ${row}`,value}]}]}));
  return run(COV,"--req",lkReq,"--report",lkRep,"--needs",lkNeeds,"--min-chars","10");
};
for (const bad of ["", "  ", [], ["approved"], true, null, 5500, 9007199254740993]) {
  const [rcN, outN]=lkRun("5500", bad, bad);
  check(("Evidence needs: lookup value and claim " + repr(JSON.stringify(bad)) + " is refused"), (rcN === 1 && contains(outN, "[INVALID_ITEM]")), ("rc=" + repr(rcN)));
}
{ const [rcN, outN]=lkRun("9007199254740993", "9007199254740993", "9007199254740993");
  check("Evidence needs: an exact 16-digit string value passes", (rcN === 0 && contains(outN, "mechanical result: consistent")), ("rc=" + repr(rcN) + " " + outN.slice(-120)));
  const [rcR, outR]=lkRun("9007199254740993", 9007199254740993, "9007199254740993");
  check("Evidence needs: the same value as a rounded JSON number is refused", (rcR === 1 && contains(outR, "[INVALID_ITEM]")), ("rc=" + repr(rcR))); }
const skillText=read(join(ROOT,"SKILL.md")), evRef=read(join(ROOT,"references","evidence-needs.md"));
check("Evidence needs: SKILL.md keeps the check opt-in and bounded", (["--needs","references/evidence-needs.md","only when the request needs","does not prove"].every((n:string)=>contains(skillText,n))));
check("Evidence needs: the reference states the boundary, manual types and authority limits", (["linePrefix","MANUAL","UNMEASURED","constraintsRevision","not authorization","whole population"].every((n:string)=>contains(evRef,n))));
}
(cite_src=read(CITE));
for (const banned of ["sample_rate", "keep_every"]) {
check(("Full coverage: our script contains no " + repr(banned)), (truth((count(cite_src, "\"\"\"") >= 3)) ? (!contains(at(split(cite_src, "\"\"\""), 2), banned)) : (!contains(cite_src, banned))), "Sampling cannot establish procurement citation reliability");
}
check("Full coverage: script discloses no sampling", (contains(cite_src, "no sampling")));
check("Full coverage: SKILL.md explains why", (contains(skill, "checking an unknown half cannot establish reliability of the rest")));
(ENSURE=join(SCRIPTS, "ensure_research.js"));
check("ensure: availability script exists", existsSync(ENSURE));
r=runProcess(process.execPath,[ENSURE]); r.returncode=r.status??-1;
check("ensure: exit code is within the contract (0/1/2)", (contains([0, 1, 2], r.returncode)), ("rc=" + repr(r.returncode)));
check("ensure: checks both self-contained checkers", (truth((contains(r.stdout, "cite_check.js"))) && truth((contains(r.stdout, "coverage_matrix.js")))));
(src_en=read(ENSURE));
check("ensure: exit 1 is disclosed as the normal default", (contains(src_en, "normal default")));
check("ensure: does not install on the user's behalf", (truth((contains(src_en, "uv tool install hyperresearch"))) && truth((!contains(replace(slice(at(split(src_en, "uv tool install hyperresearch"), 0), -(200)), "설치", ""), "install")))));
(rows={});
for (const m of finditer("(?m)^\\|\\s*\\*{0,2}([가-힣A-Za-z][^|*]*?)\\*{0,2}\\s*\\|\\s*`([^`]+)`\\s*\\|([^|]*)\\|\\s*`([^`]+)`", skill)) {
(rows[strip(group(m, 1))]={"role": group(m, 2), "needs": strip(group(m, 3)), "when": group(m, 4)});
}
check("Boundary: path table is readable", (length(rows) >= 2), (repr(sorted(rows))));
(n_default=(Array.from(Object.values(rows)).filter((r: any) => truth((at(r, "role") === "기본"))).map((r: any) => 1)).reduce((total:number,value:any)=>total+Number(value),0));
check("Boundary: exactly one `기본` role", (n_default === 1), (repr(n_default) + " defaults"));
(self_row=(rows["자립"] ?? {}));
check("Boundary: self-contained path has role `기본`", ((self_row["role"] ?? null) === "기본"), (self_row["role"] ?? "Row absent"));
check("Boundary: self-contained path timing is `상시`", starts((self_row["when"] ?? ""), "상시"), (self_row["when"] ?? "Row absent"));
check("Boundary: self-contained path has no prerequisites", (contains((self_row["needs"] ?? ""), "None")), (self_row["needs"] ?? "Row absent"));
(up_row=(rows["hyperresearch"] ?? {}));
check("Boundary: upstream path has role `선택`", ((up_row["role"] ?? null) === "선택"), (up_row["role"] ?? "Row absent"));
check("Boundary: upstream timing begins with `조건:`", starts((up_row["when"] ?? ""), "조건:"), (up_row["when"] ?? "Row absent"));
(skills_dir=dirname(ROOT));
(NAME="(?<![\\w-])[`*]{0,2}([a-z][a-z-]{2,})[`*]{0,2}\\s*skill\\b");
(referred=sorted(unique(findall(NAME, skill))));
(missing=Array.from(referred).filter((n: any) => truth(!truth(isdir(join(skills_dir, n))))).map((n: any) => n));
check("Boundary: handoff destination population is nonempty", (length(referred) >= 3), (repr(referred)));
check("Boundary: all handoff destinations exist", !truth(missing), ("missing " + repr(missing)));
listed=new Set<string>();
for (const line of lines(kr)) {
if(truth(!truth(starts(lstrip(line), "|")))) {
continue;
}
(cell=at(split(strip(strip(line), "|"), "|"), 0));
(cell=sub("\\*{1,2}|`", "", cell));
(cell=strip(sub("\\([^)]*\\)", "", cell)));
if(truth((truth(cell) && truth((!contains(["Source", "---"], cell)))))) {
listed.add(cell);
}
}
for (const src of ["나라장터", "조달청", "온비드", "알리오", "DART", "RISS", "KCI", "ScienceON", "NTIS", "KOSIS"]) {
check(("Source lens: " + repr(src) + " is listed in a table"), (Array.from(listed).map((l: any) => (contains(l, src)))).some((value:any)=>truth(value)), (repr(length(listed)) + " table rows"));
}
check("Source lens: discloses zero upstream matches (grep 0)", (contains(kr, "grep 0")));
check("Source lens: discloses absent automated lookup paths", (truth((contains(kr, "A person must retrieve"))) && truth((contains(kr, "do not invent")))));
(grades=sorted(Array.from(listed).filter((c: any) => truth(match("^(?:Primary|Secondary|Tertiary)\\b", c))).map((c: any) => c)));
check("Source lens: evidence has four tiers", (length(grades) === 4), (repr(grades)));
check("Source lens: forbids substitution with lower-tier evidence", (contains(kr, "Do not replace higher-tier evidence with lower-tier material")));
check("Source lens: forbids figures without reference dates", (contains(kr, "Do not cite figures without a reference date")));
(raw_contract=read(join(ROOT, "wrapper_contract.json")));
([contract, parse_err]=[{}, ""]);
try {
(contract=JSON.parse(raw_contract));
} catch(error) { parse_err=String(error).slice(0,60); }
check("Upstream contract: wrapper_contract.json is valid JSON", (truth(isinstance(contract, "dict")) && truth(truth(contract))), (parse_err || "Empty object"));
(req_axes=(contract["required_axes"] ?? {}));
check("Upstream contract: three required axes", (length(req_axes) === 3), (repr(sorted(req_axes))));
check("Upstream contract: all three axes are enabled", (Array.from(Object.values(req_axes)).map((v: any) => ((v["on"] ?? null) === true))).every((value:any)=>truth(value)));
check("Upstream contract: cite-check sample_rate is raised to 1.0", (((req_axes["step_14_5_cite_check"] ?? {})["sample_rate"] ?? null) === 1.0));
(n_tier=length(findall("\"tier\"", raw_contract)));
check("Upstream contract: no tier key (honors override prohibition)", (n_tier === 0), (repr(n_tier) + " keys"));
check("Upstream contract: states evidence limits (profile tuning is vibes)", (contains(skill, "profile tuning is vibes")));
check("Upstream contract: requires our checks even with upstream", (contains(skill, "rerun our own Phase 4 checks")));
(prof={});
for (const line of lines(tier)) {
if(truth(!truth(starts(lstrip(line), "|")))) {
continue;
}
(cells=Array.from(split(strip(strip(line), "|"), "|")).map((c: any) => strip(c)));
if(truth((length(cells) >= 3))) {
(key=strip(sub("[`*]", "", at(cells, 0))));
(prof[key]=strip(sub("[`*]", "", at(cells, 2))));
}
}
check("tier: Profile table is readable", (length(prof) >= 9), (repr(length(prof)) + " rows"));
check("tier: discards the lite default explicitly", (contains(tier, "Discard that default")));
(CRITICS=["instruction", "dialectic", "depth", "width"]);
for (const c of CRITICS) {
(row=(prof[("step 12 " + repr(c) + "-critic")] ?? ""));
check(("tier: " + repr(c) + "-critic is retained (upstream light skips all)"), starts(row, "Retained"), (row || "Table row absent"));
}
(models=Object.fromEntries(Array.from(CRITICS).map((c: any) => [c, strip(at(split((prof[("step 12 " + repr(c) + "-critic")] ?? ""), "·"), -(1)))])));
check("tier: critics do not all share one model tier", (length(unique(Object.values(models))) >= 2), (repr(models)));
check("tier: only instruction-critic uses opus", (truth(((models["instruction"] ?? null) === "opus")) && truth((Array.from(CRITICS).filter((c: any) => truth((c !== "instruction"))).map((c: any) => (at(models, c) === "sonnet"))).every((value:any)=>truth(value)))), (repr(models)));
check("tier: source_target is 20-50 (draft-orchestrator contract)", ((prof["step 10 source_target"] ?? null) === "20-50"), (prof["step 10 source_target"] ?? "Table row absent"));
check("tier: inherits CJK length limits (800 / 1500)", (truth(((prof["Paragraph length (CJK)"] ?? null) === "800 characters")) && truth(((prof["Paragraph length (English)"] ?? null) === "1500 characters"))), (repr((prof["Paragraph length (CJK)"] ?? null)) + " / " + repr((prof["Paragraph length (English)"] ?? null))));
check("tier: identifies the length unit by upstream symbol", (contains(tier, "char_targets_no_word_boundary")));
check("tier: declares selection of steps rather than a tier", (contains(tier, "a set of steps, not a tier")));
check("tier: SKILL.md names this document as canonical", (contains(skill, "references/tier-profile.md")));
(opt=(contract["optional_axes"] ?? {}));
for (const c of CRITICS) {
(ax=((truth((c === "instruction")) ? req_axes : opt)[("step_12_" + repr(c) + "_critic")] ?? {}));
check(("tier: configuration enables " + repr(c) + "-critic (matching documentation)"), ((ax["on"] ?? null) === true), (repr((ax["on"] ?? null))));
check(("tier: configured " + repr(c) + "-critic model matches documentation"), ((ax["model"] ?? null) === (models[c] ?? null)), ("configured " + repr((ax["model"] ?? null)) + " / documented " + repr((models[c] ?? null))));
}
(budgets=(contract["budgets"] ?? {}));
check("tier: configured source_target matches documentation", ((budgets["step_10_source_target"] ?? null) === (prof["step 10 source_target"] ?? null)), (repr((budgets["step_10_source_target"] ?? null))));
check("tier: configured paragraph lengths match the CJK table", (truth(((budgets["step_16_paragraph_chars_cjk"] ?? null) === 800)) && truth(((budgets["step_16_paragraph_chars_en"] ?? null) === 1500))), (repr((budgets["step_16_paragraph_chars_cjk"] ?? null)) + " / " + repr((budgets["step_16_paragraph_chars_en"] ?? null))));
check("tier: triple-draft remains disabled (triple cost)", (truth((((opt["step_10_triple_draft"] ?? {})["on"] ?? null) === false)) && truth(((prof["step 10 triple-draft"] ?? null) === "Disabled"))), ("configuration " + repr(((opt["step_10_triple_draft"] ?? {})["on"] ?? null)) + " / documented " + repr((prof["step 10 triple-draft"] ?? null))));
up=runProcess('hyperresearch',['--version'],{timeout:10000}).status===0;
if(up){const lib=join(homedir(),'.local/share/uv/tools/hyperresearch/lib');const hits=existsSync(lib)?readdirSync(lib).filter(name=>name.startsWith('python')).map(name=>join(lib,name,'site-packages/hyperresearch/core/citecheck.py')).filter(existsSync):[];const src=hits.length?read(hits[0]):'';check('자기검사: upstream formula matches our document (round(1/x))',src.includes('round(1 / sample_rate)'),'Update cite-check.md if upstream changes its rounding rule');}
check("Provenance: NOTICE identifies MIT and the version", (truth((contains(notice, "MIT"))) && truth((contains(notice, "v0.10.0")))));
check("grades: SKILL.md heading and description agree on general source-backed research", contains(skill_all, "# Research — source-backed deep research with verified citations") && !contains(skill_all, "deep research for procurement") && contains(skill_all, "### Map requirements to responses (procurement proposals)"));
check("grades: four evidence grades and the because rule", ["**Quoted**", "**Converging evidence**", "**Inferred**", "**Unknown**"].every(g => contains(skill_all, g)) && contains(skill_all, "Use \"because\", \"the reason is\", or \"이유는\" only for Quoted and Converging claims.") && contains(skill_all, "An empty search is a\nfinding"));
check_skill_body(check, ROOT, {needles: ["| **자립** | `기본` |", "checking an unknown half cannot establish reliability of the rest", "profile tuning is vibes", "나라장터", "deliverables/", "cite_check.js", "coverage_matrix.js", "references/tier-profile.md"], floor: 4076});
check_ref_contracts(check, ROOT, [["kr-sources.md", "Korean primary-source tiers and access rules", ["나라장터", "DART", "KCI", "grep 0", "notice or project IDs", "Research for Korean procurement proposals must consult 나라장터", "Do not replace higher-tier evidence with lower-tier material; disclose any\nsubstitution", "Do not cite figures without a reference date"], 2919], ["tier-profile.md", "jstack-lite profile and rationale for restored axes", ["Light skips every step 12 critic, including instruction-critic", "Structural blind spots shared\nby an all-opus panel can pass all four reviews", "Light's source_target of 15-25 falls below the draft-orchestrator contract of\n20-50", "Our use is exactly CJK, yet this was absent from the inheritance list", "char_targets_no_word_boundary", "must_read_note_ids", "HANDOFF.md:438"], 3641], ["cite-check.md", "Full verification and upstream stepwise behavior", ["round(1 / sample_rate)", "two on/off levels", "every pair", "Machine"], 2086], ["evidence-needs.md", "Opt-in typed evidence needs: boundary, bindings, report rows and limits", ["linePrefix", "MANUAL", "UNMEASURED", "constraintsRevision", "not authorization", "whole population", "jstack-evidence-needs/1", "Item ID format"], 9743]]);
(_tp=read(join(ROOT, "references", "tier-profile.md")));
(_crit=Array.from(lines(_tp)).filter((ln: any) => truth((truth(starts(ln, "|")) && truth((contains(ln, "critic"))) && truth((truth((contains(ln, "Skipped"))) || truth((contains(ln, "Retained")))))))).map((ln: any) => ln));
check("Profile: four critic rows have skipped/retained columns", (length(_crit) === 4), (repr(length(_crit)) + " rows"));
check("Profile: every upstream critic value is skipped", (truth(truth(_crit)) && truth((Array.from(_crit).map((ln: any) => (contains(ln, "Skipped")))).every((value:any)=>truth(value)))), repr(Array.from(_crit).filter((ln: any) => truth((!contains(ln, "Skipped")))).map((ln: any) => slice(ln, 0, 40))));
(_kr2=read(join(ROOT, "references", "kr-sources.md")));
check("Tier: sentence directs citation of higher-tier evidence", (contains(_kr2, "cite the higher tier")));
(_OFF=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
// All three deletion axes count the same final live population; no later judgments create slack.
const live_ran=results.filter(([name])=>!_OFF.some((prefix:string)=>name.startsWith(prefix))).length;
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 23, "NOTICE": 1, "wrapper_contract.json": 14, "references/kr-sources.md": 19, "references/cite-check.md": 3, "references/tier-profile.md": 23, "references/evidence-needs.md": 4}, live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 23, live_ran});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/cite_check.js": 55, "scripts/ensure_research.js": 3, "scripts/coverage_matrix.js": 51, "scripts/evidence_needs.js": 49}, live_ran, extra_skip: ["스크립트 계약:"]});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 162 + Number(up));
removeTree(tmp, {ignore_errors: true});
(passed=(Array.from(results).filter(([_name, ok, _detail]: any[]) => truth(ok)).map(([_name, ok, _detail]: any[]) => 1)).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((passed === length(results))) ? 0 : 1);
}
process.exitCode=main();
