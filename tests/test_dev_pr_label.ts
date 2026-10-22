/** Original PR-policy owning cases, with isolated repositories and Node subprocesses. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runProcess} from '../runtime/os.js';
import {truth,length,contains,repr,at,slice,strip,split,lines,search,temporaryDirectory,removeTree} from '../skills/_suite_lib_native.js';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),HOOK=join(ROOT,'hooks/validate_pr_label.js');
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
const fixtureEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
const textwrap={dedent:(value:string)=>{const indentation=Math.min(...value.split('\n').filter(line=>line.trim()).map(line=>/^\s*/.exec(line)![0].length));return value.split('\n').map(line=>line.slice(indentation)).join('\n');}};
class PolicyCase {
 LABELS=['@web','@server','bug','feature'];PRS:any[]=[...Array.from({length:8},()=>['@web','feature']),[],[]];DOCS:Record<string,string>={};root='';fixture='';preload='';
 setUp(){this.root=temporaryDirectory();const init=runProcess('git',['init','-q'],{cwd:this.root,env:fixtureEnv()});assert.equal(init.status,0,init.stderr);for(const [name,text] of Object.entries(this.DOCS)){const path=join(this.root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}this.fixture=join(this.root,'gh-fixture.json');this.preload=join(this.root,'gh-fixture.cjs');writeFileSync(this.preload,`const cp=require('node:child_process'),fs=require('node:fs');const original=cp.spawnSync;cp.spawnSync=function(command,args,options){if(command!=='gh')return original.apply(this,arguments);const fixture=JSON.parse(fs.readFileSync(process.env.JSTACK_GH_FIXTURE,'utf8'));if(fixture.state==='absent'){const error=new Error('gh absent');error.code='ENOENT';return {status:null,stdout:'',stderr:'',error};}const key=args.slice(0,2).join(' ');if(key==='auth status')return {status:fixture.state==='ready'?0:1,stdout:'',stderr:''};return {status:0,stdout:JSON.stringify(key==='label list'?fixture.labels:fixture.prs),stderr:''};};require('node:module').syncBuiltinESMExports();`);this.stub_gh(this.LABELS,this.PRS);}
 tearDown(){if(this.root)removeTree(this.root);}
 stub_gh(labels:string[],prs:string[][]){writeFileSync(this.fixture,JSON.stringify({state:'ready',labels:labels.map(name=>({name})),prs:prs.map(names=>({labels:names.map(name=>({name}))}))}));}
 invoke(command:string,gh=true){const data=JSON.parse(readFileSync(this.fixture,'utf8'));const selected=join(this.root,'gh-selected.json');writeFileSync(selected,JSON.stringify({...data,state:gh?'ready':'absent'}));const result=runProcess(process.execPath,['--require',this.preload,HOOK],{cwd:this.root,env:{...fixtureEnv(),JSTACK_GH_FIXTURE:selected},input:JSON.stringify({tool_name:'Bash',tool_input:{command}}),timeout:60000});assert.equal(result.status,0,result.stderr);return result.stdout.trim()?JSON.parse(result.stdout):{};}
 run_hook(command:string,options:{gh?:boolean}={}){return this.invoke(command,options.gh!==false);}
 policy_path(){return join(this.root,'.claude/pr-policy.json');}
 policy(){return JSON.parse(readFileSync(this.policy_path(),'utf8'));}
 write_policy(text:string){mkdirSync(dirname(this.policy_path()),{recursive:true});writeFileSync(this.policy_path(),text);}
 seed_policy(){const reason=this.run_hook('gh pr create --title seed').reason??'';const match=/```json\n([\s\S]*?)\n```/.exec(reason);assert.ok(match,'onboarding must provide parseable JSON');const data=JSON.parse(match[1]);this.write_policy(match[1]);return data;}
 gh_state_with(state:string){const fixture=join(this.root,'gh-state.json');writeFileSync(fixture,JSON.stringify({state,labels:[],prs:[]}));const result=runProcess(process.execPath,['--require',this.preload,'--input-type=module','-e',`import {ghState} from ${JSON.stringify(pathToFileURL(HOOK).href)};console.log(ghState());`],{cwd:this.root,env:{...fixtureEnv(),JSTACK_GH_FIXTURE:fixture}});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
 stub_gh_auth(code:number){return code===0?'ready':'unauthenticated';}
 assertEqual(a:any,b:any,message?:string){assert.deepEqual(a,b,message);}
 assertNotEqual(a:any,b:any,message?:string){assert.notDeepEqual(a,b,message);}
 assertTrue(value:any,message?:string){assert.ok(truth(value),message);}
 assertFalse(value:any,message?:string){assert.ok(!truth(value),message);}
 assertIn(needle:any,value:any,message?:string){assert.ok(contains(value,needle),message??`${pyStr(needle)} absent from ${pyStr(value)}`);}
 assertNotIn(needle:any,value:any,message?:string){assert.ok(!contains(value,needle),message);}
 assertRegex(value:string,pattern:string){assert.ok(search(pattern,value));}
}
class TestItOnlyWakesForPrCreate extends PolicyCase {
test_other_bash_commands_are_ignored():any{
let command:any;
for (let command of ["ls -la", "git push", "gh pr list", "gh issue create"]) {
this.assertEqual(this.run_hook(command), {});
}
}
test_nothing_is_written_for_unrelated_commands():any{
this.run_hook("git push origin main");
this.assertFalse(existsSync(this.policy_path()));
}
}
class TestNoPolicyFileMeansNoPr extends PolicyCase {
test_a_compliant_pr_is_still_blocked():any{
let result:any;
(result=this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\""));
this.assertEqual((result["decision"] ?? null), "block");
}
test_it_does_not_write_the_file_by_itself():any{
this.run_hook("gh pr create --title t");
this.assertFalse(existsSync(this.policy_path()), "created the file before a human decided");
}
test_it_shows_both_ways_out():any{
let reason:any;
(reason=at(this.run_hook("gh pr create --title t"), "reason"));
this.assertIn("pr-policy.json", reason);
this.assertIn("writeFileSync", reason, "does not explain the empty-file escape hatch");
}
test_the_suggestion_can_be_pasted_as_is():any{
let policy:any,r:any;
(policy=this.seed_policy());
this.assertEqual(new Set(Array.from(at(policy, "rules")).map((r: any) => (at(r, "group")))), new Set(["@", "_plain"]));
this.assertNotIn("decision", this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\""));
}
test_a_broken_file_is_not_a_bypass():any{
let result:any;
this.write_policy("{ broken");
(result=this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\""));
this.assertEqual((result["decision"] ?? null), "block");
}
}
class TestAnEmptyFileIsADecision extends PolicyCase {
test_an_empty_file_lets_prs_through():any{
this.write_policy("");
this.assertNotIn("decision", this.run_hook("gh pr create --title t"));
}
test_whitespace_only_counts_as_empty():any{
this.write_policy("\n  \n");
this.assertNotIn("decision", this.run_hook("gh pr create --title t"));
}
test_it_stays_silent():any{
this.write_policy("");
this.assertEqual(this.run_hook("gh pr create --title t"), {});
}
}
class TestEnforcement extends PolicyCase {
setUp():any{
super.setUp();
this.seed_policy();
}
test_a_compliant_pr_passes():any{
let result:any;
(result=this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\""));
this.assertNotIn("decision", result);
}
test_a_missing_group_is_blocked():any{
let result:any;
(result=this.run_hook("gh pr create --title t --label \"bug\""));
this.assertEqual((result["decision"] ?? null), "block");
this.assertIn("'@'", at(result, "reason"));
}
test_equals_form_is_parsed():any{
this.assertNotIn("decision", this.run_hook("gh pr create --label=@web --label=bug"));
}
}
class TestDeclaredPolicyIsFoundFirst extends PolicyCase {
DOCS:any={"CLAUDE.md": textwrap.dedent("        ## PR 규칙\n\n        ### 필수 레이블 (2개)\n\n        1. Category: `feature`, `bug`\n        2. Position: `@web`, `@server`, `@package`\n        ")};
test_the_declaring_document_is_recorded():any{
this.assertIn("CLAUDE.md", at(this.seed_policy(), "declared_sources"));
}
test_a_declared_but_undefined_label_is_reported():any{

this.assertEqual(at(this.seed_policy(), "phantom_labels"), ["@package"]);
}
test_prose_identifiers_are_not_mistaken_for_labels():any{

writeFileSync(join(this.root,"CLAUDE.md"),"### 필수 레이블\n\n`check_file_content` 를 참고하라. `@web` 필수.\n");
this.assertNotIn("check_file_content", at(this.seed_policy(), "phantom_labels"));
}
}
class TestRepositoriesThatDoNotLabel extends PolicyCase {
PRS:any=Array.from({length:10},()=>[]);
test_no_rule_is_inferred():any{
this.assertEqual(at(this.seed_policy(), "rules"), []);
}
test_it_does_not_block():any{
this.seed_policy();
this.assertNotIn("decision", this.run_hook("gh pr create --title t"));
}
}
class TestWeakEvidenceWarnsInsteadOfBlocking extends PolicyCase {
DOCS:any={"CLAUDE.md": "### 필수 레이블\n\n`@web` 과 `feature` 를 단다.\n"};
PRS:any=[...Array.from({length:5},()=>["@web","feature"]),...Array.from({length:5},()=>[])];
test_a_rule_exists_but_is_not_enforced():any{
let policy:any;
(policy=this.seed_policy());
this.assertTrue(at(policy, "rules"), "no rules were established; nothing to warn about");
this.assertFalse(at(policy, "enforced"));
}
test_it_warns_but_lets_the_pr_through():any{
let result:any;
this.seed_policy();
(result=this.run_hook("gh pr create --title t"));
this.assertNotIn("decision", result);
this.assertIn("too low to block", (result["systemMessage"] ?? ""));
}
}
class TestDeltaDetection extends PolicyCase {
test_a_new_label_refreshes_the_policy_and_reports_it():any{
let before:any,result:any;
(before=at(this.seed_policy(), "fingerprint"));
this.stub_gh([...this.LABELS,"@infra"], this.PRS);
(result=this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\""));
this.assertNotEqual(at(this.policy(), "fingerprint"), before);
this.assertIn("@infra", JSON.stringify(at(this.policy(), "rules")));
this.assertIn("refreshed", (result["systemMessage"] ?? ""));
}
test_an_edited_policy_document_also_triggers_refresh():any{
let before:any;
(before=at(this.seed_policy(), "fingerprint"));
writeFileSync(join(this.root,"CONTRIBUTING.md"),"### 필수 레이블\n\n`@web` 을 쓴다.\n");
this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\"");
this.assertNotEqual(at(this.policy(), "fingerprint"), before);
}
test_a_stale_policy_never_blocks_silently():any{
let result:any;

this.seed_policy();
this.stub_gh(["area:web", "bug", "feature"], Array.from({length:10},()=>["area:web","bug"]));
(result=this.run_hook("gh pr create --title t --label \"area:web\" --label \"bug\""));
this.assertNotIn("decision", result);
this.assertIn("refreshed", (result["systemMessage"] ?? ""));
}
}
class TestGhOnboarding extends PolicyCase {
test_a_missing_gh_still_blocks_when_nothing_is_registered():any{
let result:any;

(result=this.run_hook("gh pr create --title t", {gh: false}));
this.assertEqual((result["decision"] ?? null), "block");
}
test_it_says_how_to_install_and_authenticate():any{
let reason:any;
(reason=at(this.run_hook("gh pr create --title t", {gh: false}), "reason"));
this.assertIn("gh auth login", reason);
this.assertRegex(reason, "brew install gh|apt install gh|winget install");
}
test_it_still_offers_the_opt_out():any{
let reason:any;

(reason=at(this.run_hook("gh pr create --title t", {gh: false}), "reason"));
this.assertIn("writeFileSync", reason);
}
test_it_never_installs_anything():any{
let after:any,before:any;
(before=({stdout:JSON.stringify(readdirSync(this.root).sort())}));
this.run_hook("gh pr create --title t", {gh: false});
(after=({stdout:JSON.stringify(readdirSync(this.root).sort())}));
this.assertFalse(existsSync(this.policy_path()));
this.assertFalse(readdirSync(this.root).some(name=>/^(node_modules|bin|package-lock)/.test(name))); 
}
test_a_registered_repo_does_not_need_gh():any{
let result:any;

this.seed_policy();
(result=this.run_hook("gh pr create --title t --label \"@web\" --label \"bug\"", {gh: false}));
this.assertNotIn("decision", result);
}
}
class TestGhStateIsThreeValued extends PolicyCase {
test_no_gh_on_path_is_absent():any{
let empty:any;

(empty="absent");

this.assertEqual(this.gh_state_with(pyStr(empty)), "absent");
}
test_gh_that_fails_auth_status_is_unauthenticated():any{

this.assertEqual(this.gh_state_with(this.stub_gh_auth(1)), "unauthenticated");
}
test_gh_that_passes_auth_status_is_ready():any{
this.assertEqual(this.gh_state_with(this.stub_gh_auth(0)), "ready");
}
test_the_three_values_are_distinct():any{
let empty:any,got:any;

(empty="absent");

(got=[this.gh_state_with(pyStr(empty)), this.gh_state_with(this.stub_gh_auth(1)), this.gh_state_with(this.stub_gh_auth(0))]);
this.assertEqual(length(new Set(got)), 3, got);
}
test_absent_and_unauthenticated_get_different_guidance():any{
let absent:any;

(absent=at(this.run_hook("gh pr create --title t", {gh: false}), "reason"));
this.assertIn("not installed", absent);
this.assertNotIn("not authenticated", absent);
}
}
class TestLinkedWorktreePolicy extends PolicyCase {
 main=''; linked='';
 setUp(){super.setUp();this.main=join(this.root,'main-checkout');mkdirSync(this.main);let result=runProcess('git',['init','-q'],{cwd:this.main,env:fixtureEnv()});assert.equal(result.status,0,result.stderr);writeFileSync(join(this.main,'seed.txt'),'seed');result=runProcess('git',['add','seed.txt'],{cwd:this.main,env:fixtureEnv()});assert.equal(result.status,0,result.stderr);result=runProcess('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-q','-m','seed'],{cwd:this.main,env:fixtureEnv()});assert.equal(result.status,0,result.stderr);this.linked=join(this.root,'linked-checkout');result=runProcess('git',['worktree','add','-q','--detach',this.linked],{cwd:this.main,env:fixtureEnv()});assert.equal(result.status,0,result.stderr);}
 run_linked(command:string){const fixture=join(this.root,'gh-linked.json');writeFileSync(fixture,JSON.stringify(JSON.parse(readFileSync(this.fixture,'utf8'))));const result=runProcess(process.execPath,['--require',this.preload,HOOK],{cwd:this.linked,env:{...fixtureEnv(),JSTACK_GH_FIXTURE:fixture},input:JSON.stringify({tool_name:'Bash',cwd:this.linked,tool_input:{command}}),timeout:60000});assert.equal(result.status,0,result.stderr);return result.stdout.trim()?JSON.parse(result.stdout):{};}
 write_policy_at(root:string,text:string){mkdirSync(join(root,'.claude'),{recursive:true});writeFileSync(join(root,'.claude/pr-policy.json'),text);}
 test_main_policy_fallback_is_read_only(){const policy={version:1,observed_prs:10,confidence:1,enforced:true,rules:[{group:'@',allowed:['@web']}],fingerprint:'stale'};this.write_policy_at(this.main,JSON.stringify(policy));const before=readFileSync(join(this.main,'.claude/pr-policy.json'),'utf8');const result=this.run_linked('gh pr create --title t');this.assertEqual(result.decision,'block');this.assertEqual(readFileSync(join(this.main,'.claude/pr-policy.json'),'utf8'),before);this.assertFalse(existsSync(join(this.linked,'.claude/pr-policy.json')));}
 test_worktree_file_takes_priority_even_if_empty(){this.write_policy_at(this.main,'{ broken');this.write_policy_at(this.linked,'');this.assertEqual(this.run_linked('gh pr create --title t'),{});}
 test_worktree_broken_file_cannot_fallback(){this.write_policy_at(this.main,'');this.write_policy_at(this.linked,'{ broken');const result=this.run_linked('gh pr create --title t');this.assertEqual(result.decision,'block');}
 test_missing_on_both_checkouts_blocks(){const result=this.run_linked('gh pr create --title t');this.assertEqual(result.decision,'block');this.assertIn(`Repository: ${realpathSync(this.linked)}`,result.reason);}
}
class TestTheCommandDirectoryDecides extends PolicyCase {
 other='';
 setUp(){super.setUp();this.other=join(this.root,'other');mkdirSync(this.other);const init=runProcess('git',['init','-q'],{cwd:this.other,env:fixtureEnv()});assert.equal(init.status,0,init.stderr);}
 declare_empty(repo:string){mkdirSync(join(repo,'.claude'),{recursive:true});writeFileSync(join(repo,'.claude/pr-policy.json'),'');}
 run_payload(payload:any, environment:Record<string,string|undefined>={}){const selected=join(this.root,'gh-selected.json');writeFileSync(selected,JSON.stringify({...JSON.parse(readFileSync(this.fixture,'utf8')),state:'ready'}));const result=runProcess(process.execPath,['--require',this.preload,HOOK],{cwd:this.root,env:{...fixtureEnv(),JSTACK_GH_FIXTURE:selected,...environment},input:JSON.stringify(payload),timeout:60000});assert.equal(result.status,0,result.stderr);return result.stdout.trim()?JSON.parse(result.stdout):{};}
 test_cd_into_a_registered_repository_uses_its_policy(){this.declare_empty(this.other);this.assertEqual(this.run_hook(`cd ${this.other} && gh pr create --title t`),{});}
 test_cd_into_an_unregistered_repository_blocks_and_names_it(){this.declare_empty(this.root);const result=this.run_hook(`cd "${this.other}" && gh pr create --title t`);this.assertEqual(result.decision??null,'block');this.assertIn(`Repository: ${realpathSync(this.other)}`,result.reason);}
 test_relative_cd_resolves_from_the_hook_directory(){this.declare_empty(this.other);this.assertEqual(this.run_hook('cd other && gh pr create --title t'),{});}
 test_input_cwd_is_the_starting_directory(){this.declare_empty(this.other);this.assertEqual(this.run_payload({tool_name:'Bash',cwd:this.other,tool_input:{command:'gh pr create --title t'}}),{});}
 test_a_cd_after_the_pr_command_is_ignored(){this.declare_empty(this.other);const result=this.run_hook(`gh pr create --title t; cd ${this.other}`);this.assertEqual(result.decision??null,'block');}
 test_an_unresolvable_cd_does_not_guess(){this.declare_empty(this.other);const result=this.run_hook('cd $JSTACK_SOMEWHERE && gh pr create --title t');this.assertEqual(result.decision??null,null);this.assertIn('could not be resolved',result.systemMessage??'');}
 test_unknown_directory_does_not_use_session_policy(){const result=this.run_hook('cd $JSTACK_UNKNOWN_DIR && gh pr create --title t');this.assertNotIn('decision',result);this.assertIn('directory could not be resolved',result.systemMessage??'');this.assertFalse(existsSync(this.policy_path()));}
 test_quoted_or_recorded_commands_are_data(){for(const command of ['echo "gh pr create --title t"','git commit -m "gh pr create"','node -e "console.log(\'gh pr create\')"','# gh pr create','cat <<EOF\ngh pr create\nEOF','cat <<END-LABEL\ngh pr create\nEND-LABEL','cat <<\'EOF\'\ngh pr create\nEOF','cat <<-EOF\n\tgh pr create\n\tEOF']){this.assertEqual(this.run_hook(command),{},command);}this.assertFalse(existsSync(this.policy_path()));}
 test_local_chain_after_data_checks_target(){this.declare_empty(this.other);for(const prefix of ['echo "gh pr create";','git commit -m "gh pr create" &&','cat <<EOF\ngh pr create\nEOF\n']) this.assertEqual(this.run_hook(`${prefix} cd other && gh pr create --title t`),{},prefix);}
 test_escaped_heredoc_delimiter_preserves_following_call(){for(const delimiter of ['\\EOF','\'EOF\'','"EOF"','E\'O\'F']){const result=this.run_hook(`cat <<${delimiter}\nsample\nEOF\ngh pr create --title t`);this.assertEqual(result.decision,'block',delimiter);this.assertIn(`Repository: ${realpathSync(this.root)}`,result.reason??'');}}
 test_plain_assignment_and_environment_path(){this.declare_empty(this.other);for(const prefix of [`TARGET=${this.other}; cd ${'${TARGET}'}`,`HOME=${this.root}; cd ~/other`,`cd -- ${this.other}`,`pushd ${this.other}`])this.assertEqual(this.run_hook(`${prefix} && gh pr create --title t`),{},prefix);}
 test_inline_assignment_does_not_expand_its_own_cd_argument(){this.declare_empty(this.other);const command=`TARGET=${this.other} cd "$TARGET" && gh pr create --title t`;const result=this.run_payload({tool_name:'Bash',tool_input:{command}},{TARGET:this.root});this.assertEqual(result.decision,'block');this.assertIn(`Repository: ${realpathSync(this.root)}`,result.reason??'');}
 test_inline_assignment_with_unset_target_reports_unknown(){this.declare_empty(this.other);const command=`TARGET=${this.other} cd "$TARGET" && gh pr create --title t`;const result=this.run_payload({tool_name:'Bash',tool_input:{command}},{TARGET:undefined});this.assertNotIn('decision',result);this.assertIn('directory could not be resolved',result.systemMessage??'');}
 test_inline_home_assignment_does_not_expand_its_own_tilde(){this.declare_empty(this.other);const command=`HOME=${this.root} cd ~/other && gh pr create --title t`;const result=this.run_payload({tool_name:'Bash',tool_input:{command}},{HOME:this.other});this.assertNotIn('decision',result);this.assertIn('repository could not be resolved',result.systemMessage??'');this.assertFalse(existsSync(this.policy_path()));}
 test_literal_dollars_do_not_expand_to_environment_paths(){this.declare_empty(this.other);const result=this.run_hook("TARGET=other; cd '$TARGET' && gh pr create --title t");this.assertIn('could not be resolved',result.systemMessage??'');this.assertNotIn('decision',result);}
 test_explicit_repository_is_named_not_guessed(){const result=this.run_hook('gh pr create --repo org/another --title t');this.assertNotIn('decision',result);this.assertIn('org/another',result.systemMessage??'');this.assertIn('not applied',result.systemMessage??'');this.assertFalse(existsSync(this.policy_path()));}
 add_origin(url:string){const result=runProcess('git',['remote','add','origin',url],{cwd:this.root,env:fixtureEnv()});assert.equal(result.status,0,result.stderr);}
 test_same_explicit_repository_uses_local_policy(){this.add_origin('https://github.com/org/project.git');const result=this.run_hook('gh pr create --repo org/project --label bug');this.assertEqual(result.decision,'block');this.assertIn(`Repository: ${realpathSync(this.root)}`,result.reason??'');}
 test_same_explicit_repository_accepts_compliant_labels(){this.add_origin('git@github.com:org/project.git');this.seed_policy();const result=this.run_hook('gh pr create -R org/project --label @web --label bug');this.assertNotIn('decision',result);this.assertNotIn('not applied',result.systemMessage??'');}
 test_different_explicit_repository_is_notice_only(){this.add_origin('https://github.com/org/project.git');const result=this.run_hook('gh pr create --repo org/another --label bug');this.assertNotIn('decision',result);this.assertIn('Repository target: org/another',result.systemMessage??'');this.assertFalse(existsSync(this.policy_path()));}
 test_unrecognized_origin_is_notice_only(){this.add_origin('ssh://git@github.com/org/project.git');const result=this.run_hook('gh pr create -R org/project');this.assertNotIn('decision',result);this.assertIn('Repository target: org/project',result.systemMessage??'');this.assertFalse(existsSync(this.policy_path()));}
 test_global_repo_option_checks_same_target(){this.add_origin('https://github.com/org/project.git');const result=this.run_hook('gh -R org/project pr create --label bug');this.assertEqual(result.decision,'block');this.assertIn(`Repository: ${realpathSync(this.root)}`,result.reason??'');}
 test_global_repo_option_warns_for_other_target(){this.add_origin('git@github.com:org/project.git');const result=this.run_hook('gh -R org/another pr create --label bug');this.assertNotIn('decision',result);this.assertIn('Repository target: org/another',result.systemMessage??'');this.assertFalse(existsSync(this.policy_path()));}
 test_option_value_does_not_change_repository(){const result=this.run_hook('gh pr create --title --repo --body -Rorg/another');this.assertEqual(result.decision,'block');this.assertIn(`Repository: ${realpathSync(this.root)}`,result.reason??'');}
 test_quoted_tilde_is_not_expanded(){this.declare_empty(this.other);for(const command of ['cd "~/other" && gh pr create','cd \'~/other\' && gh pr create',`HOME=${this.root} TARGET='~/other'; cd $TARGET && gh pr create`]){const result=this.run_hook(command);this.assertNotIn('decision',result);this.assertIn('could not be resolved',result.systemMessage??'');}}
 test_explicit_target_then_local_pr_still_checks_local_policy(){const result=this.run_hook('gh pr create -R org/another; gh pr create --title t');this.assertEqual(result.decision,'block');this.assertIn('org/another',result.reason??'');this.assertIn(`Repository: ${realpathSync(this.root)}`,result.reason??'');}
 test_notice_does_not_hide_later_local_pr(){const result=this.run_hook('cd $JSTACK_UNRESOLVED && gh pr create; cd '+this.root+' && gh pr create');this.assertEqual(result.decision,'block');this.assertIn('could not be resolved',result.reason??'');}
}
test('TestLinkedWorktreePolicy.test_main_policy_fallback_is_read_only',()=>{const c=new TestLinkedWorktreePolicy();try{c.setUp();c.test_main_policy_fallback_is_read_only();}finally{c.tearDown();}});
test('TestLinkedWorktreePolicy.test_worktree_file_takes_priority_even_if_empty',()=>{const c=new TestLinkedWorktreePolicy();try{c.setUp();c.test_worktree_file_takes_priority_even_if_empty();}finally{c.tearDown();}});
test('TestLinkedWorktreePolicy.test_worktree_broken_file_cannot_fallback',()=>{const c=new TestLinkedWorktreePolicy();try{c.setUp();c.test_worktree_broken_file_cannot_fallback();}finally{c.tearDown();}});
test('TestLinkedWorktreePolicy.test_missing_on_both_checkouts_blocks',()=>{const c=new TestLinkedWorktreePolicy();try{c.setUp();c.test_missing_on_both_checkouts_blocks();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_unknown_directory_does_not_use_session_policy',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_unknown_directory_does_not_use_session_policy();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_quoted_or_recorded_commands_are_data',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_quoted_or_recorded_commands_are_data();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_local_chain_after_data_checks_target',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_local_chain_after_data_checks_target();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_escaped_heredoc_delimiter_preserves_following_call',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_escaped_heredoc_delimiter_preserves_following_call();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_plain_assignment_and_environment_path',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_plain_assignment_and_environment_path();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_inline_assignment_does_not_expand_its_own_cd_argument',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_inline_assignment_does_not_expand_its_own_cd_argument();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_inline_assignment_with_unset_target_reports_unknown',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_inline_assignment_with_unset_target_reports_unknown();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_inline_home_assignment_does_not_expand_its_own_tilde',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_inline_home_assignment_does_not_expand_its_own_tilde();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_literal_dollars_do_not_expand_to_environment_paths',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_literal_dollars_do_not_expand_to_environment_paths();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_explicit_repository_is_named_not_guessed',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_explicit_repository_is_named_not_guessed();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_same_explicit_repository_uses_local_policy',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_same_explicit_repository_uses_local_policy();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_same_explicit_repository_accepts_compliant_labels',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_same_explicit_repository_accepts_compliant_labels();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_different_explicit_repository_is_notice_only',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_different_explicit_repository_is_notice_only();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_unrecognized_origin_is_notice_only',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_unrecognized_origin_is_notice_only();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_global_repo_option_checks_same_target',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_global_repo_option_checks_same_target();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_global_repo_option_warns_for_other_target',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_global_repo_option_warns_for_other_target();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_option_value_does_not_change_repository',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_option_value_does_not_change_repository();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_quoted_tilde_is_not_expanded',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_quoted_tilde_is_not_expanded();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_explicit_target_then_local_pr_still_checks_local_policy',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_explicit_target_then_local_pr_still_checks_local_policy();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_notice_does_not_hide_later_local_pr',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_notice_does_not_hide_later_local_pr();}finally{c.tearDown();}});
test('TestItOnlyWakesForPrCreate.test_other_bash_commands_are_ignored',()=>{const c=new TestItOnlyWakesForPrCreate();try{c.setUp();c.test_other_bash_commands_are_ignored();}finally{c.tearDown();}});
test('TestItOnlyWakesForPrCreate.test_nothing_is_written_for_unrelated_commands',()=>{const c=new TestItOnlyWakesForPrCreate();try{c.setUp();c.test_nothing_is_written_for_unrelated_commands();}finally{c.tearDown();}});
test('TestNoPolicyFileMeansNoPr.test_a_compliant_pr_is_still_blocked',()=>{const c=new TestNoPolicyFileMeansNoPr();try{c.setUp();c.test_a_compliant_pr_is_still_blocked();}finally{c.tearDown();}});
test('TestNoPolicyFileMeansNoPr.test_it_does_not_write_the_file_by_itself',()=>{const c=new TestNoPolicyFileMeansNoPr();try{c.setUp();c.test_it_does_not_write_the_file_by_itself();}finally{c.tearDown();}});
test('TestNoPolicyFileMeansNoPr.test_it_shows_both_ways_out',()=>{const c=new TestNoPolicyFileMeansNoPr();try{c.setUp();c.test_it_shows_both_ways_out();}finally{c.tearDown();}});
test('TestNoPolicyFileMeansNoPr.test_the_suggestion_can_be_pasted_as_is',()=>{const c=new TestNoPolicyFileMeansNoPr();try{c.setUp();c.test_the_suggestion_can_be_pasted_as_is();}finally{c.tearDown();}});
test('TestNoPolicyFileMeansNoPr.test_a_broken_file_is_not_a_bypass',()=>{const c=new TestNoPolicyFileMeansNoPr();try{c.setUp();c.test_a_broken_file_is_not_a_bypass();}finally{c.tearDown();}});
test('TestAnEmptyFileIsADecision.test_an_empty_file_lets_prs_through',()=>{const c=new TestAnEmptyFileIsADecision();try{c.setUp();c.test_an_empty_file_lets_prs_through();}finally{c.tearDown();}});
test('TestAnEmptyFileIsADecision.test_whitespace_only_counts_as_empty',()=>{const c=new TestAnEmptyFileIsADecision();try{c.setUp();c.test_whitespace_only_counts_as_empty();}finally{c.tearDown();}});
test('TestAnEmptyFileIsADecision.test_it_stays_silent',()=>{const c=new TestAnEmptyFileIsADecision();try{c.setUp();c.test_it_stays_silent();}finally{c.tearDown();}});
test('TestEnforcement.test_a_compliant_pr_passes',()=>{const c=new TestEnforcement();try{c.setUp();c.test_a_compliant_pr_passes();}finally{c.tearDown();}});
test('TestEnforcement.test_a_missing_group_is_blocked',()=>{const c=new TestEnforcement();try{c.setUp();c.test_a_missing_group_is_blocked();}finally{c.tearDown();}});
test('TestEnforcement.test_equals_form_is_parsed',()=>{const c=new TestEnforcement();try{c.setUp();c.test_equals_form_is_parsed();}finally{c.tearDown();}});
test('TestDeclaredPolicyIsFoundFirst.test_the_declaring_document_is_recorded',()=>{const c=new TestDeclaredPolicyIsFoundFirst();try{c.setUp();c.test_the_declaring_document_is_recorded();}finally{c.tearDown();}});
test('TestDeclaredPolicyIsFoundFirst.test_a_declared_but_undefined_label_is_reported',()=>{const c=new TestDeclaredPolicyIsFoundFirst();try{c.setUp();c.test_a_declared_but_undefined_label_is_reported();}finally{c.tearDown();}});
test('TestDeclaredPolicyIsFoundFirst.test_prose_identifiers_are_not_mistaken_for_labels',()=>{const c=new TestDeclaredPolicyIsFoundFirst();try{c.setUp();c.test_prose_identifiers_are_not_mistaken_for_labels();}finally{c.tearDown();}});
test('TestRepositoriesThatDoNotLabel.test_no_rule_is_inferred',()=>{const c=new TestRepositoriesThatDoNotLabel();try{c.setUp();c.test_no_rule_is_inferred();}finally{c.tearDown();}});
test('TestRepositoriesThatDoNotLabel.test_it_does_not_block',()=>{const c=new TestRepositoriesThatDoNotLabel();try{c.setUp();c.test_it_does_not_block();}finally{c.tearDown();}});
test('TestWeakEvidenceWarnsInsteadOfBlocking.test_a_rule_exists_but_is_not_enforced',()=>{const c=new TestWeakEvidenceWarnsInsteadOfBlocking();try{c.setUp();c.test_a_rule_exists_but_is_not_enforced();}finally{c.tearDown();}});
test('TestWeakEvidenceWarnsInsteadOfBlocking.test_it_warns_but_lets_the_pr_through',()=>{const c=new TestWeakEvidenceWarnsInsteadOfBlocking();try{c.setUp();c.test_it_warns_but_lets_the_pr_through();}finally{c.tearDown();}});
test('TestDeltaDetection.test_a_new_label_refreshes_the_policy_and_reports_it',()=>{const c=new TestDeltaDetection();try{c.setUp();c.test_a_new_label_refreshes_the_policy_and_reports_it();}finally{c.tearDown();}});
test('TestDeltaDetection.test_an_edited_policy_document_also_triggers_refresh',()=>{const c=new TestDeltaDetection();try{c.setUp();c.test_an_edited_policy_document_also_triggers_refresh();}finally{c.tearDown();}});
test('TestDeltaDetection.test_a_stale_policy_never_blocks_silently',()=>{const c=new TestDeltaDetection();try{c.setUp();c.test_a_stale_policy_never_blocks_silently();}finally{c.tearDown();}});
test('TestGhOnboarding.test_a_missing_gh_still_blocks_when_nothing_is_registered',()=>{const c=new TestGhOnboarding();try{c.setUp();c.test_a_missing_gh_still_blocks_when_nothing_is_registered();}finally{c.tearDown();}});
test('TestGhOnboarding.test_it_says_how_to_install_and_authenticate',()=>{const c=new TestGhOnboarding();try{c.setUp();c.test_it_says_how_to_install_and_authenticate();}finally{c.tearDown();}});
test('TestGhOnboarding.test_it_still_offers_the_opt_out',()=>{const c=new TestGhOnboarding();try{c.setUp();c.test_it_still_offers_the_opt_out();}finally{c.tearDown();}});
test('TestGhOnboarding.test_it_never_installs_anything',()=>{const c=new TestGhOnboarding();try{c.setUp();c.test_it_never_installs_anything();}finally{c.tearDown();}});
test('TestGhOnboarding.test_a_registered_repo_does_not_need_gh',()=>{const c=new TestGhOnboarding();try{c.setUp();c.test_a_registered_repo_does_not_need_gh();}finally{c.tearDown();}});
test('TestGhStateIsThreeValued.test_no_gh_on_path_is_absent',()=>{const c=new TestGhStateIsThreeValued();try{c.setUp();c.test_no_gh_on_path_is_absent();}finally{c.tearDown();}});
test('TestGhStateIsThreeValued.test_gh_that_fails_auth_status_is_unauthenticated',()=>{const c=new TestGhStateIsThreeValued();try{c.setUp();c.test_gh_that_fails_auth_status_is_unauthenticated();}finally{c.tearDown();}});
test('TestGhStateIsThreeValued.test_gh_that_passes_auth_status_is_ready',()=>{const c=new TestGhStateIsThreeValued();try{c.setUp();c.test_gh_that_passes_auth_status_is_ready();}finally{c.tearDown();}});
test('TestGhStateIsThreeValued.test_the_three_values_are_distinct',()=>{const c=new TestGhStateIsThreeValued();try{c.setUp();c.test_the_three_values_are_distinct();}finally{c.tearDown();}});
test('TestGhStateIsThreeValued.test_absent_and_unauthenticated_get_different_guidance',()=>{const c=new TestGhStateIsThreeValued();try{c.setUp();c.test_absent_and_unauthenticated_get_different_guidance();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_cd_into_a_registered_repository_uses_its_policy',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_cd_into_a_registered_repository_uses_its_policy();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_cd_into_an_unregistered_repository_blocks_and_names_it',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_cd_into_an_unregistered_repository_blocks_and_names_it();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_relative_cd_resolves_from_the_hook_directory',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_relative_cd_resolves_from_the_hook_directory();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_input_cwd_is_the_starting_directory',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_input_cwd_is_the_starting_directory();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_a_cd_after_the_pr_command_is_ignored',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_a_cd_after_the_pr_command_is_ignored();}finally{c.tearDown();}});
test('TestTheCommandDirectoryDecides.test_an_unresolvable_cd_does_not_guess',()=>{const c=new TestTheCommandDirectoryDecides();try{c.setUp();c.test_an_unresolvable_cd_does_not_guess();}finally{c.tearDown();}});
