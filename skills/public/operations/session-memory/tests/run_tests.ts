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

const PERSIST_TABLE=[["Why a rejected approach was rejected, when the code shows no trace", "What the code does"], ["A constraint that came from outside the codebase — a person, a contract, an outage", "The commit that fixed a bug"], ["A preference the user stated once and expects to hold", "Which files exist and how they are laid out"], ["A resource that lives elsewhere — a dashboard, a ticket, an account", "Anything the conventions file already states"]];
const SESSION_TABLE=[["The last N sessions, today, yesterday", "SQLite index", "`sessions` table ordered by `session_datetime`"], ["Everything touching one project", "SQLite index", "same table filtered by `project`"], ["A keyword, an error string, a decision", "Markdown corpus", "content search over the exported sessions"], ["One session end to end", "Markdown corpus", "read the export named by its session id"]];
const STALENESS_SIGNALS=[["It names a path, symbol, flag, or command", "These are the things that get renamed, and the record does not move with them"], ["It states a version or a count", "Both change without anyone thinking of the record"], ["It describes an external system", "It changed and nobody here was told"], ["It is older than the last large change in that area", "The area was rewritten; the record was not"], ["It contradicts what you are seeing right now", "One of the two is wrong, and the present has better evidence"]];
const STALENESS_STEPS=["Do not act on it, and do not silently ignore it either.", "Establish what is true now, from the repository or from the user.", "Correct or delete the record in the same pass", "Say that it was wrong, briefly."];
const UPSTREAM_CANON={"src/main.rs": "81c198b01bca00a12cb54c9c9c0f62cb2398dcc40cf6be7d5eb782a054ee6803", "Cargo.toml": "1791c4fbdfc2e633966ce3ff969e47f55968034c69e7b73a78923dfecd6299ff", "README.md": "c496aa14d01655917bc0916fbf373ade5a887add8269c7c45b4eacfdd2996d9f"};
const BOUNDARY_SKILLS=new Set(["agent-maintenance", "decide"]);
const RECOVERY_TABLE=[["Work is complete", "Dirty diff or failing check", "Incomplete; report the live state and the conflict"], ["Work is incomplete", "Clean candidate and fresh passing evidence", "Re-verify, then it may be marked complete"], ["Any claim", "No supporting file, commit, or artifact", "Unknown; do not repeat the claim"]];
function md_rows(text:any,head:any,width:any):any{
let body:any,c:any,cells:any,line:any,out:any,s:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
(out=[]);
for (let line of lines(body)) {
(s=strip(line));
if(truth(!truth(starts(s, "|")))) {
continue;
}
(cells=Array.from(split(strip(s, "|"), "|")).map((c: any) => (strip(c))));
if(truth(((value:any)=>truth(value)?value:(compare(new Set(joinText("", cells)),new Set("-: "),"<=")))((!isDeepStrictEqual(length(cells),width))))) {
continue;
}
out.push(Array.from(cells));
}
return (truth(out) ? slice(out, 1) : out);
}
function rows(text:any,head:any):any{
let body:any,r:any;

if(truth(((!contains(text, head))))) {
return [];
}
(body=at(split(at(split(text, head, 1), 1), "\n## ", 1), 0));
return Array.from(findall("(?m)^\\| (?!---)(.+?) \\|", body)).filter((r: any) => truth(((!contains(["Worth persisting", "Signal", "What is being asked"], strip(r)))))).map((r: any) => (r));
}
function main():any{
let _:any,_cols:any,_cor:any,_doc_n:any,_idx:any,_ins:any,_known:any,_order:any,_ordered:any,_rs_gt:any,_rs_take:any,_sel:any,c:any,cargo:any,codex:any,conversation:any,declared:any,drift:any,entries:any,evidence:any,expected:any,f:any,fm:any,fp:any,got:any,got_result:any,i:any,k:any,l:any,manifest:any,migration_guide:any,missing:any,n:any,named:any,ok:any,part:any,passed:any,q:any,r:any,readme:any,recovered:any,recovery_map:any,rel:any,result:any,rs:any,s:any,sig:any,skill:any,stale:any,steps:any,t:any,tb:any,tbl:any,v:any,vault:any,want:any,x:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(stale=read(join(ROOT, "references", "staleness.md")));
(codex=read(join(ROOT, "SKILL.codex.md")));
check("Codex: native recall document exists", truth(strip(codex)));
check("Codex: prioritizes .jstack task recovery", ((value:any)=>truth(value)?((contains(codex, "workflow.js\" status <task-id>"))):value)(((contains(codex, ".jstack/tasks/<task-id>/task.json")))));
check("Codex: resume is allowed only from interrupted state", ((value:any)=>truth(value)?((contains(codex, "workflow.js resume <task-id>"))):value)(((contains(codex, "phase is `interrupted`")))));
check("Codex: rejects stale evidence and unauthorized resets", ((value:any)=>truth(value)?((contains(codex, "permission to reset"))):value)(((contains(codex, "fresh verification")))));
check("Codex: requires fresh verification after resume", ((contains(codex, "successful resume still requires fresh verification"))));
check("Codex: live state overrides historical records", ((value:any)=>truth(value)?((contains(codex, "follow the live state"))):value)(((contains(codex, "live state always overrides")))));
check("Codex: states the boundary of historical Claude chat indexing", ((contains(codex, "full historical Claude chat index is not produced by Codex"))));
check("Codex: marks unsupported recovery claims unknown", ((value:any)=>truth(value)?value:((contains(codex, "mark the claim unknown"))))(((contains(codex, "mark the claim\nunknown")))));
check("Criterion: supplies a one-sentence discriminating question", ((contains(skill, "**Would the repository already tell me this?**"))));
check("Criterion: explains that copies become stale on their own schedule", ((contains(skill, "goes stale on its own"))));
(tbl=rows(skill, "## The test for writing something down"));
check("Criterion: persistence comparison has at least four rows", (compare(length(tbl),4,">=")), (repr(length(tbl)) + " rows"));
(got=md_rows(skill, "## The test for writing something down", 2));
check("Criterion: persistence table maps what to retain versus what already exists exactly", (isDeepStrictEqual(got,Array.from(PERSIST_TABLE).map((r: any) => (Array.from(r))))), (repr(slice(Array.from(got).filter((r: any) => truth(((!contains(Array.from(PERSIST_TABLE).map((x: any) => (Array.from(x))), r))))).map((r: any) => (r)), 0, 1))));
check("Criterion: comparison headers have not been swapped", ((contains(skill, "| Worth persisting | Already in the repo |"))));
check("Criterion: reasons disappear while results remain", ((contains(skill, "Reasons evaporate; outcomes do not"))));
check("Criterion: code structure, history, and convention files are not persistence candidates", ((value:any)=>truth(value)?((contains(skill, "conventions file"))):value)(((contains(skill, "commit history")))));
check("Format: requires one fact per record", ((contains(skill, "One fact per record"))));
check("Format: explains why multiple facts make records hard to correct", ((contains(skill, "cannot be corrected"))));
check("Format: links neighboring facts instead of restating them", ((contains(skill, "rather than restating them"))));
check("Format: requires reasons alongside conclusions", ((contains(skill, "not only the conclusion"))));
check("Format: illustrates how reasonless instructions fail on uncovered cases", ((value:any)=>truth(value)?((contains(skill, "CJK grapheme"))):value)(((contains(skill, "unfollowable")))));
check("Format: converts relative dates to absolute dates", ((contains(skill, "Convert relative dates"))));
check("Format: relative dates are wrong on every later reading", ((contains(skill, "wrong on every later read"))));
check("Verification: records describe truth at the time of writing", ((contains(skill, "true when it was written"))));
check("Verification: paths, flags, and commands must be checked before use", ((contains(skill, "check it still exists before recommending it"))));
check("Verification: compares the costs of checking and not checking", ((contains(skill, "costs a confident wrong answer"))));
check("Verification: explains why stale records are worse than no records", ((contains(skill, "authority of something already decided"))));
(sig=rows(stale, "## Signals that a record must be verified"));
check("Verification: recheck-signal table has five rows", (isDeepStrictEqual(length(sig),5)), (repr(length(sig)) + " rows"));
(got=md_rows(stale, "## Signals that a record must be verified", 2));
check("Verification: all five signal/reason pairs match the canonical table", (isDeepStrictEqual(got,Array.from(STALENESS_SIGNALS).map((r: any) => (Array.from(r))))), (repr(slice(Array.from(got).filter((r: any) => truth(((!contains(Array.from(STALENESS_SIGNALS).map((x: any) => (Array.from(x))), r))))).map((r: any) => (r)), 0, 1))));
check("Verification: the working tree wins when records conflict with it", ((contains(stale, "the tree wins"))));
check("Verification: grounds that priority in what will actually run", ((contains(stale, "what will run"))));
check("Correction: requires correction instead of append-only updates", ((contains(skill, "Prefer correcting over appending"))));
check("Correction: contradiction is worse than either statement alone", ((contains(skill, "worse than either statement"))));
check("Correction: removing a false record is not information loss", ((value:any)=>truth(value)?value:((contains(skill, "Keeping a false one is"))))(((contains(skill, "Keeping a\nfalse one is")))));
(steps=findall("(?m)^\\d\\. ", stale));
check("Correction: error-discovery procedure has four steps", (isDeepStrictEqual(length(steps),4)), (repr(length(steps)) + " steps"));
(_ordered=findall("(?m)^(\\d)\\. (.+)$", stale));
check("Correction: step numbers run from 1 through 4", (isDeepStrictEqual(Array.from(_ordered).map(([n, _]: any) => (n)),["1", "2", "3", "4"])), (repr(Array.from(_ordered).map(([n, _]: any) => (n)))));
check("Correction: step bodies match canonical order", ((value:any)=>truth(value)?(Array.from(range(4)).map((i: any) => (starts(at(at(_ordered, i), 1), slice(at(STALENESS_STEPS, i), 0, 40))))).every((value:any)=>truth(value)):value)((isDeepStrictEqual(length(_ordered),4))), (repr(Array.from(_ordered).map(([_, s]: any) => (slice(s, 0, 28))))));
check("Correction: also forbids silently ignoring errors", ((contains(stale, "do not silently ignore it either"))));
check("Correction: a known error left in place is worse", ((contains(stale, "still says the wrong thing"))));
check("Correction: requires notifying the user about the erroneous record", ((contains(stale, "relying on it elsewhere"))));
check("Prohibition: forbids recording progress", ((contains(skill, "Do not record progress"))));
check("Prohibition: progress becomes false within a day and remains searchable for months", ((contains(skill, "false within a day"))));
check("Prohibition: identifies this as a pattern that undermines trust in memory", ((contains(skill, "makes memory untrustworthy"))));
(recovered=md_rows(skill, "## Recovering interrupted work from live state", 3));
check("Recovery: conversation/evidence/verdict table matches the canonical values", (isDeepStrictEqual(recovered,RECOVERY_TABLE)), (repr(recovered)));
(recovery_map=Object.fromEntries(Array.from(recovered).map(([conversation, evidence, result]: any) => ([JSON.stringify([conversation, evidence]), result]))));
for (let [conversation, evidence, expected] of RECOVERY_TABLE) {
(got_result=(recovery_map[JSON.stringify([conversation, evidence])] ?? null));
check(("Recovery fixture: " + repr(conversation) + " / " + repr(evidence)), (isDeepStrictEqual(got_result,expected)), (repr(got_result)));
}
check("Recovery: actual state wins over conflicting conversation", ((contains(skill, "The live state wins when it conflicts with the conversation"))));
check("Recovery: forbids recovery based only on remembered conversation", ((contains(skill, "Never recover from conversation memory alone"))));
check("Recovery: reads cwd, root, exact refs, status, diff, artifacts, and verification", (Array.from(["current working directory", "repository root", "exact ref", "live status", "diff", "task artifact", "test or build evidence"]).map((part: any) => (((contains(skill, part)))))).every((value:any)=>truth(value)));
check("Recovery: links every claim to files, commits, artifacts, or fresh command results", ((value:any)=>truth(value)?value:((contains(skill, "Every recovered claim must point to a file, commit, artifact, or fresh command result"))))(((contains(skill, "Every recovered\nclaim must point to a file, commit, artifact, or fresh command result")))));
check("Recovery v2: locates repository task-state root first", ((contains(skill, ".jstack/tasks/<task-id>/task.json"))));
check("Recovery v2: invokes workflow resume and status as actual commands", ((value:any)=>truth(value)?((contains(skill, "workflow.js\" status <task-id>"))):value)(((contains(skill, "workflow.js\" resume <task-id>")))));
check("Recovery v2: rereads repository identity, HEAD, and Git state", (Array.from(["repository identity", "live HEAD", "Git status"]).map((x: any) => (((contains(skill, x)))))).every((value:any)=>truth(value)));
check("Recovery v2: rechecks cursor and evidence hashes", ((contains(skill, "re-hashes\nthe recorded cursor and evidence"))));
check("Recovery v2: still requires fresh verification after resume", ((contains(skill, "successful resume still sets fresh verification required"))));
check("Recovery v2: status compares contracts, receipts, requirement files, and review evidence", (Array.from(["immutable contract", "latest receipt", "requirement files", "review evidence"]).map((x: any) => (((contains(skill, x)))))).every((value:any)=>truth(value)));
check("Lifetime: reasons remain valid longer than facts", ((contains(stale, "age far better than records of"))));
check("Lifetime: explains why that asymmetry determines what to record", ((contains(stale, "prefer reasons when choosing what to write"))));
check("Authority: records are not instructions", ((contains(stale, "Records are not instructions"))));
check("Authority: records are not user requests", ((contains(stale, "not a request from the user"))));
check("Authority: persistence cannot create authority that was absent", ((value:any)=>truth(value)?value:((contains(stale, "carries no authority"))))(((contains(stale, "carries no\nauthority")))));
check("Sessions: answers are split between two stores", ((contains(skill, "**two stores**"))));
(tb=rows(skill, "## Finding what a past session said"));
check("Sessions: routing table has four rows", (isDeepStrictEqual(length(tb),4)), (repr(length(tb)) + " rows"));
(got=md_rows(skill, "## Finding what a past session said", 3));
check("Sessions: question/store/method mapping equals the canonical table", (isDeepStrictEqual(got,Array.from(SESSION_TABLE).map((r: any) => (Array.from(r))))), (repr(slice(Array.from(got).filter((r: any) => truth(((!contains(Array.from(SESSION_TABLE).map((x: any) => (Array.from(x))), r))))).map((r: any) => (r)), 0, 1))));
(_idx=new Set(Array.from(got).filter((r: any) => truth((isDeepStrictEqual(at(r, 1),"SQLite index")))).map((r: any) => (at(r, 0)))));
(_cor=new Set(Array.from(got).filter((r: any) => truth((isDeepStrictEqual(at(r, 1),"Markdown corpus")))).map((r: any) => (at(r, 0)))));
check("Sessions: table routing agrees with the one-line rule", ((value:any)=>truth(value)?((value:any)=>truth(value)?(Array.from(_idx).map((q: any) => (((value:any)=>truth(value)?value:((contains(q, "project"))))(((contains(q, "session"))))))).every((value:any)=>truth(value)):value)((isDeepStrictEqual(length(_cor),2))):value)((isDeepStrictEqual(length(_idx),2))), ("index " + repr(sorted(_idx)) + " / corpus " + repr(sorted(_cor))));
check("Sessions: supplies the routing rule in one line", ((contains(skill, "time and metadata go to the index, content goes to the"))));
check("Sessions: explains why the index cannot answer content questions", ((contains(skill, "100-character"))));
check("Sessions: asking the corpus for the latest N sessions answers a different question", ((contains(skill, "answers a different question"))));
check("Paths: specifies CLAUDE_SESSIONS_PATH and its default", ((contains(skill, "${CLAUDE_SESSIONS_PATH:-$HOME/Documents/Obsidian/claude-code-sessions}"))));
check("Paths: specifies both index and export paths", ((value:any)=>truth(value)?((contains(skill, "sessions/<session-id>.md"))):value)(((contains(skill, ".metadata.db")))));
check("Paths: forbids hardcoding either path", ((contains(skill, "Never hardcode either"))));
check("Pipeline: identifies the Rust binary under bin/ as producer", ((contains(skill, "`bin/` holds the producer"))));
check("Pipeline: runs on SessionEnd", ((contains(skill, "`SessionEnd`"))));
check("Pipeline: assigns three prerequisites to /setup-recall", ((value:any)=>truth(value)?((contains(skill, "/setup-recall"))):value)(((contains(skill, "Three things must be true")))));
check("Pipeline: selects projects paths according to configuration profile", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(skill, "The output vault remains controlled by"))):value)(((contains(skill, "CLAUDE_CONFIG_DIR")))):value)(((contains(skill, "active profile")))));
check("Pipeline: the index stops advancing without the toolchain", ((contains(skill, "an index that never advances"))));
check("Empty result: absence does not establish absence of evidence", ((contains(skill, "not evidence that the work never happened"))));
check("Empty result: queries cannot distinguish no installation from no experience", ((contains(skill, "look identical from the query side"))));
(manifest=read(join(ROOT, "bin", "UPSTREAM.sha256")));
(entries=Array.from(lines(manifest)).filter((l: any) => truth(((value:any)=>truth(value)?!truth(starts(l, "#")):value)(strip(l)))).map((l: any) => (split(l, undefined, 1))));
check("Import: hash manifest contains three entries", (isDeepStrictEqual(length(entries),3)), (repr(length(entries)) + " entries"));
(declared=Object.fromEntries(Array.from(entries).map(([want, rel]: any) => ([strip(rel), strip(want)]))));
check("Import: declared hashes equal the canonical values (rehashing cannot pass)", (isDeepStrictEqual(declared,UPSTREAM_CANON)), joinText("; ", Array.from(Object.entries(UPSTREAM_CANON)).filter(([k, v]: any) => truth((!isDeepStrictEqual((declared[k] ?? null),v)))).map(([k, v]: any) => ((repr(k) + ": " + repr(slice((declared[k] ?? "missing"), 0, 12)) + "!=" + repr(slice(v, 0, 12)))))));
(drift=[]);
for (let [want, rel] of entries) {
(fp=join(ROOT, "bin", strip(rel)));
if(truth(!truth(existsSync(fp)))) {
drift.push((repr(strip(rel)) + "(missing)"));
continue;
}
got=createHash("sha256").update(readFileSync(fp)).digest("hex");
if(truth((!isDeepStrictEqual(got,strip(want))))) {
drift.push((repr(strip(rel)) + " " + repr(slice(got, 0, 12)) + "!=" + repr(slice(strip(want), 0, 12))));
}
}
check("Import: all three manifest files retain their exact bytes", ((value:any)=>truth(value)?!truth(drift):value)((isDeepStrictEqual(length(entries),3))), joinText("; ", drift));
check("Import: records the intermediate source commit in the legacy plugin tree", ((value:any)=>truth(value)?((contains(manifest, "session-search/bin"))):value)(((contains(manifest, "539406b")))));
check("Import: records the upstream repository", ((contains(manifest, "cc-session-sync"))));
check("Import: records layout/profile-path changes and Cargo's reason for rejecting the old layout", ((value:any)=>truth(value)?((contains(manifest, "can't find bin"))):value)(((contains(manifest, "Layout and profile paths changed")))));
(cargo=read(join(ROOT, "bin", "Cargo.toml")));
(rs=read(join(ROOT, "bin", "src", "main.rs")));
(readme=read(join(ROOT, "bin", "README.md")));
check("Import: source exists at the path Cargo.toml declares", ((value:any)=>truth(value)?existsSync(join(ROOT, "bin", "src", "main.rs")):value)(((contains(cargo, "path = \"src/main.rs\"")))));
check("Import: binary is named sync", ((contains(cargo, "name = \"sync\""))));
check("Producer: reads CLAUDE_SESSIONS_PATH", ((contains(rs, "env::var(\"CLAUDE_SESSIONS_PATH\")"))));
(vault=search("expand_home\\(\"(~/Documents/[^\"]+)\"\\)", rs));
check("Producer: default storage path equals SKILL.md's contract", ((value:any)=>truth(value)?((contains(skill, replace(group(vault, 1), "~", "$HOME")))):value)(truth(vault)), (truth(vault) ? group(vault, 1) : "default path not found in main.rs"));
check("Producer: distinguishes default and CLAUDE_CONFIG_DIR profiles", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(rs, "env::var(\"CLAUDE_CONFIG_DIR\")"))):value)(((contains(rs, "join(\"projects\")")))):value)(((contains(rs, "home_dir.join(\".claude\")")))):value)(((contains(rs, "fn projects_dir_for_config")))));
check("Producer: has runtime tests for default and alternate profile paths", ((value:any)=>truth(value)?((contains(rs, "alternate_profile_uses_config_dir_projects"))):value)(((contains(rs, "normal_profile_uses_home_claude_projects")))));
check("Producer: creates the three index-schema tables", (Array.from(["files", "session_files", "sessions"]).map((t: any) => (((contains(rs, ("CREATE TABLE IF NOT EXISTS " + repr(t)))))))).every((value:any)=>truth(value)));
check("Producer: creates both columns queried by SKILL.md", ((value:any)=>truth(value)?((contains(rs, "summary"))):value)(((contains(rs, "session_datetime")))));
check("Producer: writes exports to sessions/<id>.md", ((value:any)=>truth(value)?value:((contains(rs, "format!(\"{}.md\""))))(((contains(rs, "format!(\"sessions/{}.md\"")))));
check("Producer: index filename is .metadata.db", ((contains(rs, "\".metadata.db\""))));
(_doc_n=search("(\\d+)-character\\s+summary", skill));
(_rs_take=search("chars\\(\\)\\.take\\((\\d+)\\)", rs));
(_rs_gt=search("chars\\(\\)\\.count\\(\\) > (\\d+)", rs));
check("Cross-check: SKILL.md and main.rs use the same summary length", ((value:any)=>truth(value)?(isDeepStrictEqual(group(_doc_n, 1),group(_rs_take, 1)) && isDeepStrictEqual(group(_rs_take, 1),group(_rs_gt, 1))):value)(truth(((value:any)=>truth(value)?((value:any)=>truth(value)?_rs_gt:value)(_rs_take):value)(_doc_n))), ("document " + repr((truth(_doc_n) ? group(_doc_n, 1) : "missing")) + " / take " + repr((truth(_rs_take) ? group(_rs_take, 1) : "missing")) + " / count> " + repr((truth(_rs_gt) ? group(_rs_gt, 1) : "missing"))));
(_sel=search("SELECT ([\\w,\\s]+?) FROM sessions", skill));
(_cols=(truth(_sel) ? Array.from(split(group(_sel, 1), ",")).map((c: any) => (strip(c))) : []));
(_ins=search("INSERT INTO sessions \\(([^)]+)\\)", rs));
(_known=(truth(_ins) ? new Set(Array.from(split(group(_ins, 1), ",")).map((c: any) => (strip(c)))) : new Set()));
check("Cross-check: producer populates every column selected in the SQL example", ((value:any)=>truth(value)?((value:any)=>truth(value)?(compare(new Set(_cols),_known,"<=")):value)(truth(_known)):value)(truth(_cols)), ("example " + repr(_cols) + " / producer " + repr(sorted(_known))));
(_order=search("ORDER BY (\\w+)", skill));
check("Cross-check: SQL ordering column matches the table's method cell", ((value:any)=>truth(value)?(Array.from(SESSION_TABLE).filter((r: any) => truth((isDeepStrictEqual(at(r, 1),"SQLite index")))).map((r: any) => (((contains(at(r, 2), group(_order, 1))))))).some((value:any)=>truth(value)):value)(truth(_order)), (truth(_order) ? group(_order, 1) : "missing"));
check("Import: bin/README.md identifies the upstream repository", ((contains(readme, "github.com/ysys143/cc-session-sync"))));
check("Import: bin/README.md identifies build command and toolchain", ((value:any)=>truth(value)?((contains(readme, "rustup"))):value)(((contains(readme, "cargo build --release")))));
(named=new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill)));
(missing=Array.from(named).filter((n: any) => truth(!truth(isdir(join(SKILLS, n))))).map((n: any) => (n)));
check("Boundary: redirection target population is nonempty", (compare(length(named),1,">=")), (repr(sorted(named))));
check("Boundary: every redirection target exists", !truth(missing), ("missing " + repr(missing)));
check("Boundary: redirection targets equal the canonical roster", (isDeepStrictEqual(named,BOUNDARY_SKILLS)), (repr(sorted(named)) + " != " + repr(sorted(BOUNDARY_SKILLS))));
check("Boundary: explains ADR as the reason for redirection to decide", ((value:any)=>truth(value)?value:((contains(skill, "`decide` skill"))))(((value:any)=>truth(value)?((contains(skill, "`decide`\nskill"))):value)(((contains(skill, "architecture decision"))))));
check("Boundary: distinguishes repository ADRs from records outside the repository", ((value:any)=>truth(value)?((contains(skill, "outside it"))):value)(((contains(skill, "not a memory")))));
check("Language: description includes Korean triggers", (compare(length(findall("[가-힣]+", fm)),3,">=")));
check("L0: description names the save, find and migrate jobs", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(fm, "migrate history"))):value)(((contains(fm, "find past sessions")))):value)(((contains(fm, "Save what a later session needs")))));
(migration_guide=read(join(ROOT, "references", "session-migration.md")));
check("Migration: common recall routes only explicit migration requests", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(skill, "ordinary\nmemory searches and interrupted-task recovery must not modify native session storage"))):value)(((contains(skill, "scripts/migrate_sessions.js")))):value)(((contains(skill, "references/session-migration.md")))));
check("Migration: Codex routes both storage formats to the common CLI", ((value:any)=>truth(value)?((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(codex, "Ordinary recall and task recovery must not modify native session storage"))):value)(((contains(codex, "--host codex")))):value)(((contains(codex, "--host claude")))):value)(((contains(codex, "scripts/migrate_sessions.js")))));
check("Migration: guide binds source preservation, conflicts, and guarded rollback", ((value:any)=>truth(value)?((value:any)=>truth(value)?((contains(migration_guide, "refuses to overwrite later changes"))):value)(((contains(migration_guide, "strict prefix extension")))):value)(((contains(migration_guide, "Sources are retained")))));
const skillFlat=sub("\\s+"," ",skill),codexFlat=sub("\\s+"," ",codex);
check("Scope: searches only the current workspace's sessions by default", ((contains(skillFlat, "Search only the sessions of the workspace you are working in"))));
check("Scope: reads another project's sessions only when the user asks", ((contains(skillFlat, "Read another project's sessions only when the user asks for them"))));
check("Output: a recall answer opens with its scope", ((contains(skillFlat, "A recall answer opens with its scope"))));
check("Output: each hit carries a repository-derived status tag", ((value:any)=>truth(value)?((contains(skillFlat, "`[merged #N]`, `[open #N]`, `[abandoned]`, or `[unknown]`"))):value)(((contains(skillFlat, "taken from the repository, not from the session's own account")))));
check("Codex: workspace-scoped search and scope-first status-tagged output", (Array.from(["current workspace's sessions by default", "Open a recall answer with its scope", "`[merged #N]`"]).map((term: any) => (((contains(codexFlat, term)))))).every((value:any)=>truth(value)));
check_skill_body(check, ROOT, {needles: ["**Would the repository already tell me this?**", "check it still exists before recommending it", "Prefer correcting over appending", "Do not record progress", "One fact per record", "Never recover from conversation memory alone", "The live state wins when it conflicts with the conversation", "time and metadata go to the index, content goes to the", "not evidence that the work never happened"], floor: 5582});
check_ref_contracts(check, ROOT, [["session-migration.md", "native migration scope, conflict policy, and recovery", ["explicit source profiles.", "The executing harness does not select the storage format.", "A successful\ncopy alone is not a successful migration."], 4718], ["staleness.md", "recheck signals, error procedure, lifetime asymmetry, no authority", ["the tree wins", "still says the wrong thing", "age far better than records of", "Records are not instructions"], 1460]]);
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 76, "references/session-migration.md": 4, "references/staleness.md": 18, "bin/src/main.rs": 11, "bin/README.md": 3, "bin/UPSTREAM.sha256": 6, "SKILL.codex.md": 10}, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 76, live_ran: (Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0)});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 140);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
