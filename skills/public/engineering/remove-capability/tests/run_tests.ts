/** Prune owning contracts. Every original judgment and deletion floor is retained. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runProcess } from '../../../../../runtime/os.js';
import { check_no_constant_assertions, check_total, check_skill_body, check_ref_contracts, split_frontmatter, check_body_deletion, check_contract_coverage, check_script_contracts, type Result } from '../../../../_suite_lib.js';
const SUITE_FILE=fileURLToPath(import.meta.url), ROOT=dirname(dirname(SUITE_FILE)), SKILLS=dirname(ROOT), PRUNE=join(ROOT,'scripts','prune.js');
const results: Result[]=[];
function check(name:string,ok:boolean,detail=''):void { results.push([name,ok,detail]); console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`); }
const read=(p:string)=>readFileSync(p,'utf8');
const isdir=(p:string)=>{try{return statSync(p).isDirectory();}catch{return false;}};
function findall(pattern:string,text:string):string[]{const flags=pattern.startsWith('(?m)')?'gm':'g'; return [...text.matchAll(new RegExp(pattern.replace(/^\(\?m\)/,''),flags))].map(m=>m.length>1?m[1]:m[0]);}
function rows(text:string,head:string):string[]{if(!text.includes(head))return [];const body=text.split(head)[1].split('\n## ')[0];return findall('(?m)^\\| (?!---)(.+?) \\|',body).filter(r=>!['Remove when','Trace','Exit'].includes(r.trim()));}
function skillfolder(tmp:string,name:string,skills:Record<string,string|null>):string{const cfg=join(tmp,name),root=join(cfg,'skills');mkdirSync(root,{recursive:true});for(const [sk,body] of Object.entries(skills)){const d=join(root,sk);mkdirSync(d,{recursive:true});if(body!==null)writeFileSync(join(d,'SKILL.md'),body);}return cfg;}
const fmBody=(name:string,description:string)=>`---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`;
function prune(args:string[],env:NodeJS.ProcessEnv=process.env):[number,string]{const r=runProcess(process.execPath,[PRUNE,...args],{env});return [r.status??-1,r.stdout];}
function main():number {
const [fm,skill]=split_frontmatter(read(join(ROOT,'SKILL.md')));
const lst=read(join(ROOT,'references','removal-checklist.md'));

check("decision: persistent cost is the criterion", (skill.includes("every turn of every session")));
check("decision: 'not used recently' is excluded as a criterion", ((skill.includes("not \"has anyone used it lately\"")) || (skill.includes("not \"has anyone used it lately\""))));
check("decision: states the criterion in one sentence", (skill.includes("still earn the space it occupies")));
const keep=rows(skill, "## What justifies removal");
check("decision: remove/keep comparison has at least four rows", (keep.length >= 4), (String(keep.length) + " rows"));
check("decision: being short is not a reason", (skill.includes("length is not the cost")));
check("decision: rewriting later is replacement, not removal", (skill.includes("that is a rewrite, not a removal")));
check("decision: requires learning the reason first", (skill.includes("find out first")));
check("decision: identifies the most ignored item", (skill.includes("the one that gets ignored")));
check("decision: explains that rationale cannot be recovered after deletion", (skill.includes("not recoverable afterwards")));
check("duplication: merge before deleting", (skill.includes("resolved by merge, not by deletion")));
check("duplication: requires verifying that the neighbor carries the content", (skill.includes("neighbour actually says what the removed one said")));
check("duplication: states that homeless content disappears silently", (skill.includes("nothing announces the loss of")));
const steps=findall("(?m)^\\d\\. ", skill);
check("traces: four deletion targets are listed", (steps.length >= 4), (String(steps.length) + " items"));
check("traces: partial removal is worse than none", (skill.includes("worse than none")));
check("traces: neighbor boundary sentences are checked", (skill.includes("a suite that is not the one you were editing")));
check("traces: requires removing the red case set too", (skill.includes("red-suite case set")));
check("traces: explains the one-commit bisect reason", (skill.includes("bisected through looks like")));
check("verification: requires neighbor suites and path gates", ((skill.includes("run the suites of every skill that named")) && (skill.includes("path gate"))));
check("verification: states that the gate finds stale references", (skill.includes("nothing else reads those paths")));
check("verification: green caused by a vanished subject is not a pass", (skill.includes("subject vanished falls under")));
const inner=rows(lst, "## In the plugin tree");
const outer=rows(lst, "## Outside the plugin tree");
check("checklist: at least five in-tree traces", (inner.length >= 5), (String(inner.length) + " rows"));
check("checklist: at least three outside-tree traces", (outer.length >= 3), (String(outer.length) + " rows"));
check("checklist: calls out directory deletion as the only commonly performed step", (lst.includes("the only one people do")));
check("checklist: states that detection counts over a vanished tree are false", (lst.includes("is a false number, not zero")));
check("checklist: calls out inventory as mistaken for automatic refresh", (lst.includes("assume it regenerates")));
check("checklist: states that the catalog lives elsewhere", (lst.includes("different file from everything else")));
check("order: delete the directory last", (lst.includes("Delete the directory last")));
check("order: the live subject makes traces easier to find", (lst.includes("while the thing still exists")));
check("order: deleting first turns each trace into a separate search", (lst.includes("separate search")));
check("scope: neighbor rewrites use a separate commit", (lst.includes("**separate**")));
check("scope: combining them makes both questions unanswerable", ((lst.includes("cannot answer\neither question")) || (lst.includes("cannot answer either question"))));
check("scope: requires recording when neighbor changes are unnecessary", (lst.includes("say so in the commit message")));
check("scope: silence reads as not reviewed", (lst.includes("reads as \"not considered\"")));
const named=[...new Set(findall("`([a-z][a-z-]{2,})`\\s*skill", skill))];
const missing=named.filter(n=>!isdir(join(SKILLS,n)));
check("boundary: handoff target population is nonempty", (named.length >= 3), (String([...named].sort())));
check("boundary: all handoff targets exist", missing.length === 0, ("missing " + String(missing)));
check("Language: description names the Korean activation intent", ["스킬 삭제"].every(term => fm.includes(term)));
check("language: description also contains English triggers", (fm.includes("Remove") && fm.includes("agent")));
check("Protocol: body states the persistent-cost criterion", (skill.includes("every turn of every session") && skill.includes("earn the space")));
check("diagnostic: SKILL.md references the script", (skill.includes("`scripts/prune.js`")));
check("diagnostic: states that it changes nothing", (skill.includes("It changes nothing and deletes nothing")));
const exits=rows(skill, "## Measure the folder before you argue about it");
check("diagnostic: exit-code table has three rows", (exits.length === 3), (String(exits.length) + " rows"));
check("diagnostic: unscannable differs from clean", (skill.includes("a scan that never happened are different facts")));
check("diagnostic: collapsing them counts a vanished check as pass", (skill.includes("the same defect as counting a")));
check("diagnostic: an always-success diagnostic cannot be composed", (skill.includes("cannot be aggregated by anything")));
check("diagnostic: --json uses the same function as the table", (skill.includes("produced by the same")));

const tmp=mkdtempSync(join(tmpdir(),'jstack-prune-contract-'));
try {
const clean=skillfolder(tmp,'clean',{good:fmBody('good','short description')});
let [rc,out]=prune(['--config-dir',clean]);
check('runtime: clean directory returns rc 0',rc===0,`rc=${rc}`);
check('runtime: rc 0 still prints a measured result',out.includes('Total issues: 0'),out.trim().slice(-40));
const broken=skillfolder(tmp,'broken',{});
symlinkSync(join(tmp,'nowhere'),join(broken,'skills','dangling'));
[rc,out]=prune(['--config-dir',broken]);
check('runtime: broken link returns rc 1, not 0',rc===1,`rc=${rc}`);
check('runtime: reports the defect by name',out.includes('broken link'));
const mism=skillfolder(tmp,'mismatch',{dirname:fmBody('othername','description')});
[rc,out]=prune(['--config-dir',mism]);
check('runtime: directory/name mismatch returns rc 1',rc===1,`rc=${rc}`);
const fat=skillfolder(tmp,'fat',{fat:fmBody('fat','x'.repeat(2000))});
[rc,out]=prune(['--config-dir',fat]);
check('runtime: exceeding 1536 characters returns rc 1',rc===1,`rc=${rc}`);
const [rc_t,out_t]=prune(['--config-dir',broken,'--config-dir',fat]);
const [rc_j,out_j]=prune(['--config-dir',broken,'--config-dir',fat,'--json']);
let doc:Record<string,any>={};try{doc=JSON.parse(out_j);}catch{}
const summary=doc.summary??{};
check('runtime: --json is valid JSON',Object.keys(doc).length>0,out_j.trim().slice(0,60));
check('runtime: --json includes summary.total',Number.isInteger(summary.total)&&(summary.total??0)>=2,String(summary.total));
check('runtime: --json exit code matches table mode',rc_j===rc_t&&rc_t===1,`json=${rc_j} table=${rc_t}`);
check('runtime: --json total matches the table total',out_t.includes(`Total issues: ${summary.total}`),out_t.trim().slice(-30));
check('runtime: --json declared exit matches the process rc',summary.exit===rc_j,`${summary.exit} vs ${rc_j}`);
check('runtime: --json includes per-directory details',isDeepStrictEqual(Object.keys(doc.dirs??{}).sort(),[broken,fat].sort()),JSON.stringify(Object.keys(doc.dirs??{}).sort()));
[rc]=prune([],{...Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='CLAUDE_CONFIG_DIR'&&key!=='CODEX_HOME')),HOME:join(tmp,'empty-home'),USERPROFILE:join(tmp,'empty-home')});
check('runtime: no config directories returns rc 2, distinct from 0',rc===2,`rc=${rc}`);
// Preserve the original directory inventory read-only check.
const before=readdirSync(join(broken,'skills')).sort();
prune(['--config-dir',broken]);
const after=readdirSync(join(broken,'skills')).sort();
check('runtime: changes nothing',isDeepStrictEqual(before,after),`${before} vs ${after}`);
}finally{rmSync(tmp,{recursive:true,force:true});}

check_skill_body(check, ROOT, {needles: ["still earn the space it occupies", "resolved by merge, not by deletion", "subject vanished falls under", "worse than none", "path gate", "a scan that never happened are different facts", "cannot be aggregated by anything"], floor: 2892});
check_ref_contracts(check, ROOT, [["removal-checklist.md", "inside/outside traces, order, and exclusions", ["the only one people do", "is a false number, not zero", "Delete the directory last", "reads as \"not considered\""], 1232]]);
const META=['자기검사:', '계약 커버리지:', '스크립트 계약:']; const live_ran=results.filter(r=>!META.some(prefix=>r[0].startsWith(prefix))).length;
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/prune.js": 12}, live_ran: live_ran});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 37, "references/removal-checklist.md": 16, "scripts/prune.js": 12}, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 37, live_ran: live_ran});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 80);
const passed=results.filter(r=>r[1]).length;console.log(`\n${passed}/${results.length} 통과`);return passed===results.length?0:1; }
process.exitCode=main();
