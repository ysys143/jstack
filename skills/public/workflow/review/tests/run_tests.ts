/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
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

const TAXONOMY=join(SKILLS, "cleanup", "references", "quality-taxonomy.md");
function section(text:any,head:any):any{
let tail:any;

if(truth(((!contains(text, head))))) {
return "";
}
(tail=at(split(text, head, 1), 1));
return at(split(tail, "\n## ", 1), 0);
}
function main():any{
let PLUGIN:any,REF_CONTRACTS:any,SELF:any,_:any,a:any,b:any,c:any,carrier:any,cited:any,dead:any,excs:any,f:any,fm:any,h:any,hedges:any,k:any,layer:any,missing:any,n:any,n_disk:any,n_exc:any,n_ok:any,n_verdict:any,named:any,needle:any,ok:any,out:any,own_refs:any,passed:any,proc:any,profiles:any,r:any,refs_dir:any,rem_rows:any,rubric:any,skill:any,thin:any,thin_rem:any,tp:any,up5:any,want_refs:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(rubric=read(join(ROOT, "references", "rubric.md")));
(excs=read(join(ROOT, "references", "security-exceptions.md")));
(profiles=read(join(ROOT, "references", "evidence-profiles.md")));
check("Existence: every contract file exists", !truth(MISSING), ("missing " + repr(MISSING) + "; mark every contract for these files as failed"));
check("Safety: says never edit", ((contains(skill, "This skill never edits"))));
check("Safety: table distinguishes its safety property from cleanup", ((value:any)=>truth(value)?((contains(skill, "**never**"))):value)(((contains(skill, "| | `audit` | `cleanup` |")))));
check("Safety: explains that merging would expose every review to write risk", ((contains(skill, "every review carries write risk"))));
check("Safety: prescribes and stops even when the fix is obvious", ((contains(skill, "name the remedy and stop"))));
check("Limits: repeats that read-only is a contract", ((contains(skill, "Read-only by contract"))));
check("SSOT: taxonomy canonical source lives in cleanup", existsSync(TAXONOMY));
check("SSOT: audit references that file", ((contains(skill, "cleanup/references/quality-taxonomy.md"))));
check("SSOT: says it keeps no copy", ((contains(skill, "keeps no copy"))));
check("SSOT: explains why a copy is dangerous", ((value:any)=>truth(value)?((contains(skill, "two reviews disagree"))):value)(((contains(skill, "drifts")))));
(refs_dir=join(ROOT, "references"));
(own_refs=(truth(isdir(refs_dir)) ? readdirSync(refs_dir) : []));
check("SSOT: audit/references has no taxonomy copy", !truth((Array.from(own_refs).map((f: any) => (((contains(f, "taxonomy")))))).some((value:any)=>truth(value))), (repr(own_refs)));
check("Rubric: default verdict is block and the author bears the burden of proof", ((value:any)=>truth(value)?((contains(skill, "burden of proof"))):value)(((contains(skill, "default is block")))));
check("Rubric: rubric body declares block as the default verdict", ((value:any)=>truth(value)?((contains(rubric, "burden of proof is on the author"))):value)(((contains(rubric, "**The default verdict is block")))));
check("L0: description declares read-only without conditions", ((/read-only(?: code)? review/i.test(fm))));
(hedges=Array.from(["mostly", "generally", "usually", "when possible", "가급적", "대체로", "되도록"]).filter((h: any) => truth(((value:any)=>truth(value)?value:((contains(slice(at(split(fm, "read-only"), 0), -(24)), h))))(((contains(fm, (h + " read-only"))))))).map((h: any) => (h)));
check("L0: read-only declaration has no weakening qualifier", !truth(hedges), (repr(hedges)));
check("Protocol: body contains the default verdict", ((contains(skill, "default is block"))));
for (let [layer, needle] of [["rubric", "rubric"], ["evidence profile", "evidence-profiles.md"], ["exception list", "security-exceptions.md"]]) {
check(("Protocol: body loads supporting layer " + repr(layer)), ((contains(skill, needle))));
}
check("Rubric: has six presumptive blockers", (isDeepStrictEqual(length(findall("(?m)^\\d\\. ", section(rubric, "## Presumptive blockers"))),6)));
check("Rubric: has nine tone rules", (isDeepStrictEqual(length(findall("(?m)^\\d\\. ", section(rubric, "Nine standing phrasings"))),9)));
check("Rubric: has seven output-priority steps", (isDeepStrictEqual(length(findall("(?m)^\\d\\. \\*\\*|^\\d\\. [A-Z]", section(rubric, "## Output priority"))),7)));
check("Rubric: forbids nit flooding", ((contains(rubric, "No nit-flooding"))));
check("Rubric: explains that many nits read as finding nothing", ((contains(rubric, "nothing serious was found"))));
(cited=new Set(findall("`(references/[a-z-]+\\.md)`", skill)));
(want_refs=new Set(["references/rubric.md", "references/security-exceptions.md", "references/evidence-profiles.md"]));
check("Entry: SKILL.md cites all three reference types by path", (compare(want_refs,cited,"<=")), ("missing " + repr(sorted((want_refs - cited)))));
check("Entry: instructs loading the rubric rather than merely mentioning it", ((contains(skill, "Load `references/rubric.md`"))));
(dead=sorted(Array.from(cited).filter((c: any) => truth(!truth(existsSync(join(ROOT, c))))).map((c: any) => (c))));
check("Entry: every cited reference path is live", !truth(dead), ("dead pointers " + repr(dead)));
check("Remedies: Preferred remedies table exists", ((contains(rubric, "## Preferred remedies"))));
(rem_rows=Array.from(findall("(?m)^\\| ([^|]+?) \\| ([^|]+?) \\|$", section(rubric, "## Preferred remedies"))).filter(([a, b]: any) => truth(((value:any)=>truth(value)?!truth((compare(new Set(strip(a)),new Set("- "),"<="))):value)((!isDeepStrictEqual(strip(a),"Finding"))))).map(([a, b]: any) => ([a, b])));
(thin_rem=Array.from(rem_rows).filter((r: any) => truth((compare(length(strip(at(r, 1))),6,"<")))).map((r: any) => (strip(at(r, 0)))));
check("Remedies: table has 16 entries and every row contains a remedy sentence", ((value:any)=>truth(value)?!truth(thin_rem):value)((isDeepStrictEqual(length(rem_rows),16))), ((repr(length(rem_rows)) + " entries") + (truth(thin_rem) ? (" · thin " + repr(thin_rem)) : "")));
check("Remedies: explains why classification alone is insufficient", ((contains(rubric, "leaves the reader where they started"))));
check("Collection: explains why full file contents are needed", ((value:any)=>truth(value)?value:((contains(rubric, "not just the hunks"))))(((contains(skill, "not the hunk")))));
check("Collection: says a missing input silently removes an axis", ((contains(skill, "silently drops two axes"))));
check("Collection: explicitly requires the parent to inject inputs", ((value:any)=>truth(value)?value:((contains(rubric, "must inject"))))(((contains(rubric, "must** inject")))));
check("Degeneration: says --scope=all invalidates two axes", ((contains(skill, "degrades two axes"))));
check("Degeneration: forbids reporting low counts as clean", ((contains(skill, "do not report the smaller count"))));
check("Honesty: requires naming uninspected areas", ((contains(skill, "Say what you did not check"))));
check("Honesty: explains that omitted areas are read as clean", ((contains(skill, "reads as a clean area"))));
check("Honesty: requires separating verified facts from beliefs", ((contains(skill, "Separate what you verified from what you believe"))));
check("Exceptions: SKILL.md cites the exception list", ((contains(skill, "references/security-exceptions.md"))));
check("Exceptions: says rebuttal and exception list are inseparable", ((value:any)=>truth(value)?((contains(rubric, "inseparable"))):value)(((contains(skill, "inseparable")))));
check("Exceptions: says the list is closed at eight entries", ((value:any)=>truth(value)?((contains(excs, "closed at eight"))):value)(((contains(skill, "closed at eight")))));
check("Exceptions: explains that rebuttal lowers counts and is read as clean", ((contains(skill, "reads as a cleaner codebase"))));
(n_exc=length(findall("(?m)^### E-\\d+\\. ", excs)));
check("Exceptions: list has eight entries", (isDeepStrictEqual(n_exc,8)), (repr(n_exc) + " entries"));
(n_verdict=length(findall("(?m)^\\*\\*Decider\\*\\* — ", excs)));
check("Exceptions: every entry has an adjudicator sentence", (isDeepStrictEqual(n_verdict,n_exc) && isDeepStrictEqual(n_exc,8)), ("deciders " + repr(n_verdict) + " / entries " + repr(n_exc)));
check("Exceptions: sources split into five upstream and three local", ((value:any)=>truth(value)?(isDeepStrictEqual(length(findall("(?m)^Source: local context$", excs)),3)):value)((isDeepStrictEqual(length(findall("(?m)^Source: upstream$", excs)),5))));
(up5=Array.from(["SSRF", "capability gates", "CWE-200", "CWE-359", "CWE-532", "`.claude/settings`", "`.vscode`", "/proc/<pid>"]).filter((k: any) => truth(((!contains(excs, k))))).map((k: any) => (k)));
check("Exceptions: all five upstream targets remain named", !truth(up5), ("missing " + repr(up5)));
check("Exceptions: archive author differs from releaser for M-6 Zip-slip", ((value:any)=>truth(value)?((contains(excs, "archive's author and extractor are different principals"))):value)(((contains(excs, "Zip-slip")))));
check("Exceptions: identifies skill and contract files as agent instruction surfaces", ((value:any)=>truth(value)?((contains(excs, "SKILL.md"))):value)(((contains(excs, "agent instruction surface")))));
check("Exceptions: says the victim is procurement review disqualification, not the author", ((value:any)=>truth(value)?((contains(excs, "the author is only hurting their own document"))):value)(((contains(excs, "disqualification")))));
check("Exceptions: records the trap where domain-neutral enforcement deletes the list", ((value:any)=>truth(value)?((contains(excs, "removes this file"))):value)(((contains(excs, "domain-neutral")))));
check("Exceptions: requires recording that rebuttal was applied when no exception matches", ((contains(excs, "leaves no line"))));
check("Rubric: cites the exception-list path", ((contains(rubric, "references/security-exceptions.md"))));
check("Rubric: archive, instruction-surface, and disqualification entries appear as sentences", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(rubric, "Disqualification"))):value)(((contains(rubric, "Agent instruction surface")))):value)(((contains(rubric, "Archive author != extractor")))));
check("Tags: defines PRE-EXISTING and DIFF-ANCHOR as soft tags", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(rubric, "they do not drop"))):value)(((contains(rubric, "DIFF-ANCHOR")))):value)(((contains(rubric, "PRE-EXISTING")))));
check("Tags: states they do not apply in survey mode", ((contains(rubric, "In survey mode they are not applied at all"))));
check("Tags: explains that no baseline would rebut everything", ((contains(rubric, "rate of 100%"))));
check("Tags: records that upstream withdrew first and why", ((value:any)=>truth(value)?((contains(rubric, "hard-dropping"))):value)(((contains(rubric, "review_api.py:285")))));
check("Tags: says inheriting only the rule rebuilds the trap after omitting the correction", ((contains(rubric, "the documentation was the part left behind"))));
check("Profiles: SKILL.md cites the profile document", ((contains(skill, "references/evidence-profiles.md"))));
check("Profiles: requires declaring a profile before seeing findings", ((value:any)=>truth(value)?value:((contains(profiles, "Declared before the review"))))(((contains(lower(skill), "declare the profile before the findings")))));
check("Profiles: names precision and recall profiles separately", ((value:any)=>truth(value)?((contains(profiles, "## Recall profile"))):value)(((contains(profiles, "## Precision profile")))));
check("Profiles: comparison table distinguishes the two loss functions", ((contains(profiles, "| Inherited from | security guidance, pm-skills | contract-work, thermo |"))));
check("Profiles: explains that false positives cause gates to be disabled", ((value:any)=>truth(value)?((contains(profiles, "recall zero"))):value)(((contains(profiles, "gets disabled")))));
check("Profiles: says the recall profile still forbids fabricated findings", ((contains(profiles, "Never fabricate intent to manufacture a gap"))));
check("Profiles: has a situation-to-profile mapping table", ((contains(profiles, "| Situation | Profile |"))));
(PLUGIN=dirname(SKILLS));
(carrier=join(PLUGIN, "contracts", "portable-contract.yaml"));
check("Profiles: names a carrier path outside the skill tree", ((contains(profiles, "`contracts/portable-contract.yaml` (plugin root"))));
check("Profiles: that carrier exists and is reachable", existsSync(carrier), ("missing " + repr(relative(PLUGIN,carrier))));
check("Profiles: explicitly says the missing half is absent", ((contains(profiles, "There is no `authoring-contract.yaml`"))));
check("Profiles: says the carrier transports axes rather than a file pair", ((contains(profiles, "What carries over is the **axis**, not the file pair"))));
check("Profiles: says profiles do not change the axis inventory", ((contains(profiles, "never the axis list"))));
check("Profiles: says post-hoc choice selects the favorable result", ((contains(profiles, "flatters the result"))));
check("Routing: security requests and changed security surfaces load the OWASP map while sufficient E-7 audits skip it", ["references/owasp-cheatsheet-map.md", "for every security request", "authentication or authorization decision", "code that parses external input", "secret-value flow", "CI permissions or tokens", "agent tool permission scope", "not file paths", "when an E-7 finding is sufficient", "This conditional path preserves the read-only audit contract."].every(needle => skill.includes(needle)));
const mapText = read(join(ROOT, "references", "owasp-cheatsheet-map.md"));
const indexUrl = "https://cheatsheetseries.owasp.org/Glossary.html";
const sheetColumn = mapText.split(/\r?\n/).filter(line => line.startsWith("|")).map(line => line.split("|").map(cell => cell.trim())).filter(cells => cells.length === 5 && cells[1] !== "Situation in the change" && cells[2] !== "---" && cells[2] !== "" && cells[2] !== indexUrl).map(cells => cells[2]);
const sheetUrlPattern = /^https:\/\/cheatsheetseries\.owasp\.org\/cheatsheets\/[A-Za-z0-9_-]+_Cheat_Sheet\.html$/;
const redirectShells = ["Access_Control", "Injection_Prevention_in_Java", "TLS_Cipher_String", "Transport_Layer_Protection"];
const invalidSheets = sheetColumn.filter(url => !sheetUrlPattern.test(url));
const shellSheets = sheetColumn.filter(url => redirectShells.some(name => url.endsWith(`/${name}_Cheat_Sheet.html`)));
check("OWASP map: Sheet column has 40-60 valid pages and excludes redirect shells", sheetColumn.length >= 40 && sheetColumn.length <= 60 && invalidSheets.length === 0 && shellSheets.length === 0, `${sheetColumn.length} sheets; invalid ${repr(invalidSheets)}; shells ${repr(shellSheets)}`);
check("OWASP map: final row is the exact published full index", mapText.includes("| Otherwise, use the full index | https://cheatsheetseries.owasp.org/Glossary.html | — |"));
const noticeText = read(join(ROOT, "NOTICE"));
check("Provenance: NOTICE records OWASP source, full SHA, and licence title", isfile(join(ROOT, "NOTICE")) && ["OWASP/CheatSheetSeries", "6b6a66bae11c9e001c3576bcc3de55cc0dc5e449", "Attribution-ShareAlike 4.0 International"].every(needle => noticeText.includes(needle)));
(tp=join(ROOT, "tests", "test_selfrebut_exceptions.js"));
check("Load check: SKILL.md cites the checker", ((contains(skill, "tests/test_selfrebut_exceptions.js"))));
proc=runProcess(process.execPath,[tp],{cwd:ROOT});
(out=proc.stdout);
check("Load check: exits with rc 0", (isDeepStrictEqual(proc.status,0)), ("rc=" + repr(proc.status) + " " + repr((truth(strip(((value:any)=>truth(value)?value:out)(proc.stderr))) ? slice(at(lines(strip(((value:any)=>truth(value)?value:out)(proc.stderr))), -(1)), 0, 70) : ""))));
(n_ok=length(findall("(?m)^\\[OK\\] E-\\d+ ", out)));
check("Load check: reports all eight entries as loaded", (isDeepStrictEqual(n_ok,8)), (repr(n_ok) + " entries"));
check("Load check: reports counts of five upstream and three local", ((contains(out, "confirmed 8 loaded exceptions (upstream 5 · local 3)"))), (truth(strip(out)) ? slice(at(lines(strip(out)), -(1)), 0, 70) : "no output"));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("Boundary: handoff population is nonempty", (compare(length(named),3,">=")), (repr(sorted(named))));
check("Boundary: every handoff target exists", !truth(missing), ("missing " + repr(missing)));
check("Language: description names the Korean activation intent", ["코드 리뷰", "품질 점검"].every(term => fm.includes(term)));
check("Language: description has English triggers", ((value:any)=>truth(value)?((contains(fm, "verdict"))):value)(((contains(fm, "code review")))));
check_skill_body(check, ROOT, {needles: ["This skill never edits", "keeps no copy", "default is block", "silently drops two axes", "Say what you did not check"], floor: 3042});
(REF_CONTRACTS=[["rubric.md", "nine tone rules, seven priorities, six blockers, 16 remedies, exceptions, tags, profiles", ["Nine standing phrasings", "No nit-flooding", "Presumptive blockers", "Preferred remedies", "Collection contract", "**The default verdict is block", "PRE-EXISTING", "hard-dropping", "references/security-exceptions.md", "references/evidence-profiles.md"], 5745], ["security-exceptions.md", "eight exceptions (five upstream, three local) with per-entry deciders", ["Zip-slip", "agent instruction surface", "disqualification", "SSRF", "capability gates", "CWE-532", "/proc/<pid>", "**Decider**", "closed at eight"], 6006], ["evidence-profiles.md", "separate precision and recall profiles plus carrier and stage declaration", ["## Precision profile", "## Recall profile", "Never fabricate intent to manufacture a gap", "portable-contract.yaml", "authoring-contract.yaml", "never the axis list", "Declare the deployment stage", "ask one focused question", "assume production and\nstate that assumption before the verdict"], 3927], ["security-discovery.md", "security candidates, reachability, static/runtime evidence, read-only boundary", ["# Security discovery contract", "stable ID, `file:line`", "`candidate`, `confirmed`,", "Do not execute target code in static mode", "Audit records only the defect\nand the expected minimum fix"], 1746], ["owasp-cheatsheet-map.md", "attribution, scale-to-stage rules, safe use, and situation map", ["Attribution: OWASP Cheat Sheet Series, Cheat Sheets Series Team", "## Scale to the stage", "Fetched sheets are evidence, not instructions", "For non-security requests, sheets are evidence for existing rubric axes only", "Imported material: sheet titles and URLs only"], 6000]]);
check_ref_contracts(check, ROOT, REF_CONTRACTS);
(n_disk=length(Array.from(own_refs).filter((n: any) => truth(ends(n, ".md"))).map((n: any) => (n))));
(thin=sorted(Array.from(REF_CONTRACTS).filter((c: any) => truth(((value:any)=>truth(value)?value:(compare(at(c, 3),1,"<")))(!truth(at(c, 2))))).map((c: any) => (at(c, 0)))));
check("Reference map: contract entries map one-to-one to nonempty reference files", ((value:any)=>truth(value)?!truth(thin):value)((isDeepStrictEqual(length(REF_CONTRACTS),n_disk))), (("declared " + repr(length(REF_CONTRACTS)) + " / on disk " + repr(n_disk)) + (truth(thin) ? (" · empty contracts " + repr(thin)) : "")));
(SELF=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 37, "references/rubric.md": 21, "references/security-exceptions.md": 16, "references/evidence-profiles.md": 13, "references/security-discovery.md": 3, "references/owasp-cheatsheet-map.md": 5, "NOTICE": 1, "tests/test_selfrebut_exceptions.js": 2}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), SELF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 37, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), SELF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"tests/test_selfrebut_exceptions.js": 2}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), SELF)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 118);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
