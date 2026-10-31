/** Original development hook cases executed with Node and isolated Git fixtures. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,statSync,readdirSync,chmodSync} from 'node:fs';
import {dirname,basename,join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {devNull} from 'node:os';
import {runProcess} from '../runtime/os.js';
import {DEPRECATED_MODELS,checkModelStatus} from '../scripts/models_database.js';
import {truth,length,contains,repr,at,slice,strip,split,lines,search,match,findall,group,sorted,temporaryDirectory,removeTree} from '../skills/_suite_lib_native.js';
import {exit_if_timed_out} from '../skills/_suite_lib.js';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),HOOKS=join(ROOT,'hooks'),SCRIPTS=join(ROOT,'scripts');
const EMOJI='[\\u{1f300}-\\u{1faff}\\u2600-\\u27bf\\u2b00-\\u2bff\\ufe0f]';
function isfile(path:string){try{return statSync(path).isFile();}catch{return false;}}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function toSet(value:any=[]):Set<any>{return new Set(value&&typeof value[Symbol.iterator]==='function'?value:Object.keys(value));}
function globFiles(directory:string,pattern:string){return readdirSync(directory).filter(name=>name.endsWith(pattern.slice(1))&&!name.endsWith('.test.js')).map(name=>join(directory,name));}
function env_with(extra:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{const inherited=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));return {...inherited,JSTACK_SESSION_AUTOCOMMIT:'',GIT_AUTHOR_NAME:'probe',GIT_AUTHOR_EMAIL:'probe@example.invalid',GIT_COMMITTER_NAME:'probe',GIT_COMMITTER_EMAIL:'probe@example.invalid',GIT_CONFIG_GLOBAL:devNull,GIT_CONFIG_SYSTEM:devNull,...extra};}
function subprocessRun(argv:string[],options:any={}){const result=runProcess(argv[0],argv.slice(1),{cwd:options.cwd,env:options.env??env_with(),input:options.input,timeout:120000});exit_if_timed_out(result,argv.join(' '));return {returncode:result.status,stdout:result.stdout,stderr:result.stderr};}
function git(root:string,...args:any[]){const options=typeof args.at(-1)==='object'?args.pop():{};return subprocessRun(['git',...args],{cwd:root,env:options.env??env_with()});}
function temp_repo(){const root=temporaryDirectory();assert.equal(git(root,'init','-q','-b','main').returncode,0);writeFileSync(join(root,'seed.txt'),'seed\n');assert.equal(git(root,'add','-A').returncode,0);const committed=git(root,'commit','-q','-m','chore: seed');assert.equal(committed.returncode,0,committed.stderr);return root;}
function commit_count(root:string){return Number(git(root,'rev-list','--count','HEAD').stdout.trim()||0);}
function stub(name:string,body:string){const root=temporaryDirectory(),target=join(root,name+'.cjs');writeFileSync(target,body);if(process.platform==='win32')writeFileSync(join(root,name+'.cmd'),'@echo off\nnode "%dp0%/'+name+'.cjs" %*\n');else{writeFileSync(join(root,name),'#!'+process.execPath+'\n'+body);chmodSync(join(root,name),0o755);}return {root,value:root+delimiter+(process.env.PATH??'')};}
function stub_claude(message:string){return stub('claude',`require('node:fs').readFileSync(0);console.log(${JSON.stringify(message)});`);}
function stub_gh(){const box=stub('gh',`const key=process.argv.slice(2,4).join(' ');if(key==='label list')console.log('[{"name":":cat"},{"name":":pos"}]');else if(key==='pr list')console.log('[{"labels":[{"name":":cat"}]}]');`);return {...box,value:env_with({PATH:box.value})};}
function run_hook(name:string,payload:any,options:any={}){let path=join(HOOKS,name);if(name==='validate_before_publish.js'&&options.cwd){const root=options.cwd;mkdirSync(join(root,'hooks'),{recursive:true});mkdirSync(join(root,'runtime'),{recursive:true});copyFileSync(path,join(root,'hooks',name));copyFileSync(join(ROOT,'runtime/entry.js'),join(root,'runtime/entry.js'));writeFileSync(join(root,'package.json'),'{"type":"module"}');path=join(root,'hooks',name);}return subprocessRun([process.execPath,path],{...options,input:payload===null?'':JSON.stringify(payload)});}
function decision(result:any){for(const line of result.stdout.split('\n')){if(!line.trim().startsWith('{'))continue;try{return JSON.parse(line).decision??'';}catch{}}return '';}
function write(content:string){return {tool_name:'Write',tool_input:{file_path:'probe.py',content}};}
function bash(command:string){return {tool_name:'Bash',tool_input:{command}};}
function seed_plugin(root:string,options:any={}){const {name='probe',version='1.0.0',readme=true,root_table=true,marketplace_version=version}=options;const plugin=join(root,'plugins',name);mkdirSync(join(plugin,'.claude-plugin'),{recursive:true});writeFileSync(join(plugin,'.claude-plugin/plugin.json'),JSON.stringify({name,description:'d',version}));if(readme)writeFileSync(join(plugin,'README.md'),`# ${name}\n\n## v${version}\n\n- initial\n`);if(root_table)writeFileSync(join(root,'README.md'),`| plugin | version |\n|---|---|\n| ${name} | ${version} |\n`);mkdirSync(join(root,'.claude-plugin'),{recursive:true});writeFileSync(join(root,'.claude-plugin/marketplace.json'),JSON.stringify({plugins:[{name,version:marketplace_version}]}));git(root,'add','-A');return plugin;}
class Case{
 assertEqual(a:any,b:any,message?:string){assert.deepEqual(a,b,message);}
 assertNotEqual(a:any,b:any,message?:string){assert.notDeepEqual(a,b,message);}
 assertTrue(value:any,message?:string){assert.ok(truth(value),message);}
 assertFalse(value:any,message?:string){assert.ok(!truth(value),message);}
 assertIn(needle:any,value:any,message?:string){assert.ok(contains(value,needle),message??`${pyStr(needle)} absent from ${pyStr(value)}`);}
 assertNotIn(needle:any,value:any,message?:string){assert.ok(!contains(value,needle),message);}
 assertRegex(value:string,pattern:string){assert.ok(search(pattern,value));}
}
class TestTheHooksArrived extends Case {
PRE:any=["dispatch.js"];
EXPECTED_BY_EVENT:any={"PreToolUse": this.PRE, "PostToolUse": ["dispatch.js"], "Stop": ["commit-session.js"], "SessionStart": ["load-recent-changes.js", "ensure-statusline.mjs"]};
EXPECTED:any=Array.from(Array.from(Object.values(this.EXPECTED_BY_EVENT)).flatMap((names: any) => Array.from(names).map((name: any) => (name))));
test_every_inherited_hook_is_present():any{
let name:any,path:any;
for (let name of this.EXPECTED) {
(path=(truth((isDeepStrictEqual(name,"hwpx_guard.js"))) ? join(join(join(join(ROOT,"skills"),"hwpx"),"hooks"),name) : join(HOOKS,name)));
this.assertTrue(isfile(path));
}
}
test_the_model_database_is_in_scripts():any{
this.assertTrue(isfile(join(SCRIPTS,"models_database.js")));
}
test_hooks_json_registers_every_hook():any{
let commands:any,document:any,name:any;
(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
(commands=JSON.stringify(document));
for (let name of this.EXPECTED) {
this.assertIn(name, commands);
}
}
test_plugin_root_is_quoted_for_space_safe_hook_execution():any{
let command:any,commands:any,document:any,entries:any,entry:any,hook:any;
(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
(commands=Array.from(Object.values(at(document, "hooks"))).flatMap((entries: any) => Array.from(entries).flatMap((entry: any) => Array.from((entry["hooks"] ?? [])).filter((hook: any) => truth(((contains((hook["command"] ?? ""), "${CLAUDE_PLUGIN_ROOT}"))))).map((hook: any) => (at(hook, "command"))))));
this.assertTrue(commands);
for (let command of commands) {
this.assertIn("\"${CLAUDE_PLUGIN_ROOT}/", command);
}
}
fired(event:any):any{
let command:any,document:any,entry:any,hook:any,names:any;

(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
(names=[]);
for (let entry of (at(document, "hooks")[event] ?? [])) {
for (let hook of (entry["hooks"] ?? [])) {
(command=(hook["command"] ?? ""));
if(truth(command)) {
names.push(command.match(/\/([^/"']+)["'](?:\s|$)/)?.[1]??strip(at(split(command, "/"), -(1)), "\"'"));
}
}
}
return names;
}
test_the_chain_order_follows_the_ledger():any{

this.assertEqual(Array.from(this.PRE), this.fired("PreToolUse"));
}
test_every_event_declared_is_the_event_present():any{
let document:any,event:any,names:any;

(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
this.assertEqual(sorted(at(document, "hooks")), sorted(this.EXPECTED_BY_EVENT));
for (let [event, names] of Object.entries(this.EXPECTED_BY_EVENT) as [string,string[]][]) {
this.assertEqual(Array.from(names), this.fired(event));
}
}
test_the_stop_hook_is_async_with_a_timeout():any{
let document:any,entry:any,hook:any;

(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
(entry=at(at(at(document, "hooks"), "Stop"), 0));
this.assertEqual(at(entry, "matcher"), "");
(hook=at(at(entry, "hooks"), 0));
this.assertTrue(at(hook, "async"));
this.assertEqual(at(hook, "timeout"), 120);
}
test_session_start_only_fires_on_startup():any{
let document:any;

(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
this.assertEqual(at(at(at(at(document, "hooks"), "SessionStart"), 0), "matcher"), "startup");
}
test_every_hook_has_a_contract_block():any{
let block:any,chunk:any,key:any,name:any,sections:any,text:any;

(text=readFileSync(join(HOOKS,"CONTRACT.md"),"utf8"));
(sections={});
for (let chunk of slice(split(text, "\n## "), 1)) {
(sections[at(split(at(split(chunk, "\n", 1), 0)), 0)]=chunk);
}
for (let name of this.EXPECTED) {
this.assertIn(name, sections, (pyStr(name) + " has no contract block"));
(block=at(sections, name));
for (let key of ["matcher:", "block when:", "exit contract:"]) {
this.assertIn(key, block, (pyStr(name) + " contract lacks " + pyStr(key)));
}
}
}
}
class TestNoEmojiSurvivedTheMigration extends Case {
files():any{

return [...globFiles(HOOKS,'*.js'),...globFiles(SCRIPTS,'*.js')];
}
test_no_hook_emits_an_emoji():any{
let hits:any,offenders:any,path:any;
(offenders=[]);
for (let path of this.files()) {
(hits=findall(EMOJI,readFileSync(path,"utf8")));
if(truth(hits)) {
offenders.push((pyStr(basename(path)) + ": " + pyStr(length(hits)) + " occurrences"));
}
}
this.assertEqual(offenders, []);
}
test_the_signal_survived_as_a_word():any{
let text:any;

(text=readFileSync(join(HOOKS,"validate_uv_usage.js"),"utf8"));
this.assertRegex(text, "\\[(WARN|HINT|NOTE|DOC|BLOCK|OK|FAIL)\\]");
}
}
class TestTheModelCheckerStillJudges extends Case {
test_a_retired_model_is_blocked():any{
this.assertEqual(run_hook("check_model_versions.js", write("m = \"claude-3-opus-20240229\"")).returncode, 1);
}
test_the_four_series_boundary_holds():any{
this.assertEqual(run_hook("check_model_versions.js", write("m = \"claude-sonnet-4-6\"")).returncode, 1);
this.assertEqual(run_hook("check_model_versions.js", write("m = \"claude-opus-4-8\"")).returncode, 1);
this.assertEqual(run_hook("check_model_versions.js", write("m = \"claude-opus-5\"")).returncode, 0);
}
test_the_latest_gemini_passes():any{
this.assertEqual(run_hook("check_model_versions.js", write("m = \"gemini-3.8-flash\"")).returncode, 0);
}
test_an_unknown_model_is_named():any{
let result:any;
(result=run_hook("check_model_versions.js", write("m = \"claude-made-up-9-9\"")));
this.assertEqual(result.returncode, 0);
this.assertIn("claude-made-up-9-9", (result.stdout + result.stderr));
}
test_a_broken_database_path_is_reported_not_silent():any{
const root=temporaryDirectory();try{mkdirSync(join(root,'hooks'));mkdirSync(join(root,'runtime'));copyFileSync(join(HOOKS,'check_model_versions.js'),join(root,'hooks/check_model_versions.js'));copyFileSync(join(ROOT,'runtime/entry.js'),join(root,'runtime/entry.js'));writeFileSync(join(root,'package.json'),'{"type":"module"}');const result=subprocessRun([process.execPath,join(root,'hooks/check_model_versions.js')],{cwd:root,input:JSON.stringify(write('model = "claude-made-up-9-9"'))});this.assertEqual(result.returncode,0);this.assertIn('no decision was made',result.stdout);this.assertIn('scripts/models_database.js',result.stdout);}finally{removeTree(root);}

}
}
class TestModelFindingsInDocumentsAreAdvisory extends Case {
runWrite(filePath:string){return run_hook("check_model_versions.js",{tool_name:'Write',tool_input:{file_path:filePath,content:'m = "claude-sonnet-4-6"'}});}
test_a_markdown_document_warns_without_blocking():any{
const result=this.runWrite("docs/report.md");
this.assertEqual(result.returncode, 0);
this.assertIn("additionalContext", result.stdout);
this.assertIn("claude-sonnet-4-6", result.stdout);
}
test_a_file_outside_the_project_warns_without_blocking():any{
const outside=temporaryDirectory();let result:any;try{result=this.runWrite(join(outside,'scratch.py'));}finally{removeTree(outside);}
this.assertEqual(result.returncode, 0);
this.assertIn("additionalContext", result.stdout);
}
test_project_code_still_blocks():any{
this.assertEqual(this.runWrite("src/app.py").returncode, 1);
}
test_bash_still_blocks():any{
this.assertEqual(run_hook("check_model_versions.js", bash('python run.py --model "claude-sonnet-4-6"')).returncode, 1);
}
test_superseded_models_point_to_current_successors():any{
for (const [name,info] of Object.entries(DEPRECATED_MODELS)) { if (!info.replacement) continue; const [deprecated,target]=checkModelStatus(info.replacement); this.assertTrue(target!==undefined, `${name} points to unknown ${info.replacement}`); this.assertFalse(deprecated, `${name} points to superseded ${info.replacement}`); }
}
}
class TestBashChecksModelSelectionNotMentions extends Case {
// A Bash command that only carries a model name as data, a search term, or text does not select a model.
sample():string{const name=Object.keys(DEPRECATED_MODELS).find(n=>{const [old,info]=checkModelStatus(n);return old&&info?.status==='outdated'&&!info.warn_only&&/^(claude|gpt|gemini)-[a-z0-9.-]+$/.test(n);});this.assertTrue(name!==undefined,'the database must carry an outdated, blocking provider-prefixed model');return name!;}
test_a_command_that_only_mentions_a_model_passes():any{
const s=this.sample();
for (const command of [`grep -A6 '"${s}"' models_database.ts`, `echo ${s}`, `git commit -m "bump ${s}"`, `grep -rn 'model="${s}"' src/`, `rg '"model": "${s}"' logs/`, `jq -n '{model: "${s}"}'`, `echo "use --model ${s}"`, `git commit -m "default model=${s}"`, `python -m pytest -k ${s}`, `git -c user.name=x commit -m "${s} is outdated"`, `git -C /tmp/repo log -S 'model="${s}"'`, `find . -name '*.py' | xargs grep -l 'model="${s}"'`, `LC_ALL=C grep -rn 'model="${s}"' src`, `sed -n '/model="${s}"/p' app.py`, `sqlite3 usage.db "select count(*) from runs where model = '${s}'"`, `gh pr create --title "drop ${s}" --body "model=${s} is retired"`, `cat README.md # see --model ${s}`, `count=$(grep -c '${s}' usage.jsonl)`, `for m in ${s} other; do grep -c "$m" usage.jsonl; done`, `pytest tests -k ${s}`]) { const result=run_hook("check_model_versions.js", bash(command)); this.assertEqual(result.returncode, 0, command); this.assertNotIn("OUTDATED", (result.stdout + result.stderr), command); }
}
test_a_command_that_writes_a_model_name_warns_without_blocking():any{
const s=this.sample();
for (const command of [`cat > stats.json <<'EOF'\n{"models": {"claude": [["${s}", 0.6]]}}\nEOF`, `cat > usage.jsonl <<'EOF'\n{"model": "${s}", "tokens": 120}\nEOF`, `cat > app.py <<'EOF'\nDEFAULT = "${s}"\nEOF`, `sed -i 's/NEW/${s}/' app.py`, `git commit -m "$(cat <<'EOF'\nfix: drop ${s}\nEOF\n)"`, `sed -Ei 's/NEW/${s}/' app.py`, `yq -i '.model = "${s}"' config.yaml`]) { const result=run_hook("check_model_versions.js", bash(command)); this.assertEqual(result.returncode, 0, command); this.assertIn("additionalContext", result.stdout, command); this.assertIn(s, result.stdout, command); }
}
test_a_command_that_selects_a_model_still_blocks():any{
const s=this.sample();
for (const command of [`python run.py --model=${s}`, `python -c "client.create(model='${s}')"`, `curl -d '{"model":"${s}"}' https://api.example.invalid`, `codex exec -m ${s} "fix the bug"`, `gemini -m ${s} -p hi`, `python run.py --model ${s} > out.log 2>&1`, `aider --model openai/${s}`, `claude -p hi --model anthropic/${s}`, `curl -d "{\\"model\\": \\"${s}\\"}" https://api.example.invalid`, `out=$(python run.py --model ${s})`, `echo "$(llm -m ${s} 'hi')"`, `echo '{"model":"${s}"}' | curl -d @- https://api.example.invalid`, `python - <<'EOF'\nclient.create(model="${s}")\nEOF`, `grep x file; claude --model ${s}`, `python eval.py --judge-model ${s}`, `ollama run ${s}`, `python run.py --model ${s},`, `BODY=$(jq -n '{model:"${s}"}'); curl -d "$BODY" https://api.example.invalid`, `{ echo '{"model":"${s}"}'; } | curl -d @- https://api.example.invalid`, `pytest evals --model ${s}`, `gh workflow run eval.yml -f model=${s}`, `git bisect run python eval.py --model ${s}`]) { const result=run_hook("check_model_versions.js", bash(command)); this.assertEqual(result.returncode, 1, command); this.assertIn(s, result.stderr, command); }
}
test_a_profile_path_is_not_a_model():any{
// A profile directory that ends like a model names a path, in a command or in written content (#144).
const s=this.sample(), writeTo=(filePath:string,content:string)=>run_hook("check_model_versions.js",{tool_name:'Write',tool_input:{file_path:filePath,content}});
for (const command of [`CLAUDE_CONFIG_DIR=$HOME/.${s} claude plugin list`, `for d in ~/.claude ~/.${s}; do f=$d/x; python3 -c "print(1)"; done`, `python run.py --out results/${s}/out.json`]) { const result=run_hook("check_model_versions.js", bash(command)); this.assertEqual([result.returncode, result.stdout, result.stderr], [0, "", ""], command); }
for (const filePath of ["docs/setup.md", "src/profiles.py"]) { const result=writeTo(filePath, `PROFILE = "~/.${s}"  # plugins in ~/.${s}/plugins, results in results/${s}/`); this.assertEqual([result.returncode, result.stdout], [0, ""], filePath); }
this.assertEqual(writeTo("src/profiles.py", `PROFILE = "~/.${s}"\nMODEL = "${s}"`).returncode, 1);
}
}
class TestTheUvHookStillJudges extends Case {
test_pip_is_blocked():any{
this.assertIn("block", run_hook("validate_uv_usage.js", bash("pip install requests")).stdout);
}
test_uv_add_passes():any{
this.assertNotIn("block", run_hook("validate_uv_usage.js", bash("uv add requests")).stdout);
}
test_an_unrelated_command_passes():any{
this.assertNotIn("block", run_hook("validate_uv_usage.js", bash("ls -la")).stdout);
}
test_uv_pip_install_without_a_venv_is_blocked():any{
let raw:any,result:any;

{const _box1=temporaryDirectory();raw=_box1;try{(result=run_hook("validate_uv_usage.js", bash("uv pip install requests"), {cwd: raw}));}finally{removeTree(_box1);}}
this.assertEqual(result.returncode, 0);
this.assertEqual(decision(result), "block");
this.assertIn(".venv not found", result.stdout);
}
}
class TestTheAttributionHookBlocksAiTrailers extends Case {
H="block_ai_attribution.js";
test_quoted_mentions_and_clean_commits_pass():any{
for (const command of ["grep -rn \"Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\" .", "echo 'Claude-Session: x'", "git commit -m \"docs: explain the trailer ban\"", "cat > notes.md <<'EOF'\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nEOF\ngit commit -m \"docs: add notes\""]) {
const result=run_hook(this.H, bash(command));
this.assertEqual(result.returncode, 0);
this.assertEqual(decision(result), "", command);
}
}
test_a_trailer_in_dash_m_is_blocked_with_the_phrase_to_remove():any{
const result=run_hook(this.H, bash("git add -A && git commit -m \"feat: add x\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\""));
this.assertEqual(decision(result), "block");
this.assertIn("Co-Authored-By: Claude", result.stdout);
this.assertIn("remove every line", result.stdout);
}
test_the_default_heredoc_form_is_blocked():any{
const result=run_hook(this.H, bash("git commit -m \"$(cat <<'EOF'\nfeat: add x\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nEOF\n)\""));
this.assertEqual(decision(result), "block");
this.assertIn("Generated with [Claude Code]", result.stdout);
}
test_dash_f_files_and_stdin_heredocs_are_read():any{
let root:any;
{const _box=temporaryDirectory();root=_box;try{
writeFileSync(join(root,"msg.txt"),"feat: add x\n\nClaude-Session: abc\n");
this.assertEqual(decision(run_hook(this.H, bash("git commit -F msg.txt"), {cwd: root})), "block");
this.assertEqual(decision(run_hook(this.H, bash("git commit --file=msg.txt"), {cwd: root})), "block");
this.assertEqual(decision(run_hook(this.H, bash("git commit -F - <<'EOF'\nfeat: add x\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nEOF")) ), "block");
writeFileSync(join(root,"clean.txt"),"feat: add x\n\nWhy and how.\n");
this.assertEqual(decision(run_hook(this.H, bash("git commit -F clean.txt"), {cwd: root})), "");
}finally{removeTree(_box);}}
}
test_amend_without_a_new_message_checks_the_reused_message():any{
let root:any;
{const _box=temp_repo();root=_box;try{
writeFileSync(join(root,"a.txt"),"a\n");git(root,"add","a.txt");
this.assertEqual(git(root,"commit","-q","-m","feat: add a\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>").returncode, 0);
this.assertEqual(decision(run_hook(this.H, bash("git commit --amend --no-edit"), {cwd: root, env: env_with()})), "block");
this.assertEqual(decision(run_hook(this.H, bash("git commit --amend -m \"feat: add a\""), {cwd: root, env: env_with()})), "");
}finally{removeTree(_box);}}
}
test_trailer_matching_ignores_case_and_colon_spacing():any{
let root:any;
const second=run_hook(this.H, bash("git commit -m \"feat: add x\" -m \"Co-authored-by: claude <noreply@anthropic.com>\""));
this.assertEqual(decision(second), "block");
this.assertIn("remove every line", second.stdout);
this.assertEqual(decision(run_hook(this.H, bash("git commit -F - <<'EOF'\nfeat: add x\n\nCO-AUTHORED-BY :  Claude\nEOF"))), "block");
this.assertEqual(decision(run_hook(this.H, bash("gh pr create --title t --body \"Summary\n\ngenerated with claude code\"")) ), "block");
{const _box=temporaryDirectory();root=_box;try{
writeFileSync(join(root,"msg.txt"),"feat: add x\n\nclaude-session : 123\n");
this.assertEqual(decision(run_hook(this.H, bash("git commit -F msg.txt"), {cwd: root})), "block");
}finally{removeTree(_box);}}
this.assertEqual(decision(run_hook(this.H, bash("git commit -m \"feat: add x\" -m \"Reviewed-by: a person\"")) ), "");
}
test_relative_message_files_follow_cd_and_git_dash_c():any{
let root:any;
{const _box=temporaryDirectory();root=_box;try{
mkdirSync(join(root,"repo"),{recursive:true});
writeFileSync(join(root,"repo","msg.txt"),"feat: add x\n\nco-authored-by: claude <x@y>\n");
for (const command of ["cd repo && git commit -F msg.txt", "cd repo; git commit -F msg.txt", "git -C repo commit -F msg.txt", "cd repo && git commit --file=msg.txt"]) {
this.assertEqual(decision(run_hook(this.H, bash(command), {cwd: root})), "block", command);
}
const missing=run_hook(this.H, bash("cd repo && git commit -F absent.txt"), {cwd: root});
this.assertEqual(decision(missing), "");
this.assertIn("Unverifiable message file", missing.stdout);
}finally{removeTree(_box);}}
}
test_the_payload_cwd_is_where_relative_message_files_resolve():any{
let root:any;
{const _box=temporaryDirectory();root=_box;try{
writeFileSync(join(root,"msg.txt"),"feat: add x\n\nClaude-Session: abc\n");
const payload=(command:string)=>({tool_name:"Bash",cwd:root,tool_input:{command}});
this.assertEqual(decision(run_hook(this.H, payload("git commit -F msg.txt"))), "block");
this.assertEqual(decision(run_hook(this.H, payload("git commit -m \"feat: add x\""))), "");
}finally{removeTree(_box);}}
}
test_trailer_flag_values_are_checked():any{
for (const command of ["git commit -m \"feat: add x\" --trailer \"Co-authored-by: Claude <noreply@anthropic.com>\"", "git commit -m \"feat: add x\" --trailer=\"Co-authored-by: Claude <noreply@anthropic.com>\"", "git commit -m \"feat: add x\" --trailer \"Co-authored-by=Claude <noreply@anthropic.com>\""]) {
this.assertEqual(decision(run_hook(this.H, bash(command))), "block", command);
}
this.assertEqual(decision(run_hook(this.H, bash("git commit -m \"feat: add x\" --trailer \"Reviewed-by: a person\" --trailer \"Signed-off-by=a person\""))), "");
}
test_stdin_that_is_not_a_heredoc_is_reported_not_passed():any{
let root:any;
{const _box=temporaryDirectory();root=_box;try{
writeFileSync(join(root,"msg.txt"),"feat: add x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n");
for (const command of ["printf 'x' | git commit -F -", "git commit -F - < msg.txt", "gh pr create --title t --body-file - < msg.txt"]) {
const result=run_hook(this.H, bash(command), {cwd: root});
this.assertEqual(decision(result), "", command);
this.assertIn("Unverifiable message file", result.stdout, command);
this.assertIn("(stdin)", result.stdout, command);
}
const heredoc=run_hook(this.H, bash("git commit -F - <<'EOF'\nfeat: add x\n\nWhy and how.\nEOF"), {cwd: root});
this.assertNotIn("Unverifiable", heredoc.stdout);
}finally{removeTree(_box);}}
}
test_only_a_line_that_starts_with_the_phrase_counts():any{
for (const command of ["git commit -m \"docs: explain why Co-Authored-By: Claude is banned\"", "git commit -m \"docs: add notes\n\nThe hook rejects a Generated with Claude Code footer.\"", "git commit -m \"feat: add x\" -m \"Co-authored-by: Claudette <c@example.com>\"", "gh pr create --title t --body \"> Co-Authored-By: Claude is quoted here\""]) {
this.assertEqual(decision(run_hook(this.H, bash(command))), "", command);
}
for (const command of ["git commit -m \"feat: add x\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)\"","git commit -m \"feat: add x\n\n  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\"", "gh pr create --title t --body \"Summary\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)\""]) {
this.assertEqual(decision(run_hook(this.H, bash(command))), "block", command);
}
}
test_shell_wrappers_with_a_clustered_c_flag_are_read():any{
const trailer="feat: add x\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
this.assertEqual(decision(run_hook(this.H, bash("bash -lc 'git commit -m \""+trailer+"\"'"))), "block");
}
test_a_long_clustered_flag_word_does_not_stall():any{
// A quadratic flag pattern needs tens of seconds for this word; a linear one needs milliseconds. The bound is far above either spawn cost.
const started=Date.now();
const long=run_hook(this.H, bash("bash -"+"c".repeat(300000)+"1 git commit -m \"feat: add x\""));
this.assertEqual(long.returncode, 0);
this.assertEqual(decision(long), "");
this.assertTrue(Date.now()-started<5000, "a 300000-character flag word took "+(Date.now()-started)+" ms");
}
test_human_co_authors_named_claude_pass_and_ai_names_do_not():any{
let root:any;
const message=(trailer:string)=>"feat: add x\n\n"+trailer;
for (const trailer of ["Co-authored-by: Claude Monet <claude@example.com>", "Co-authored-by: Claude Debussy <cd@example.com>", "Co-Authored-By: Claude Shannon <cs@example.com>", "Co-authored-by: Claudette <c@example.com>", "Co-authored-by: Claude-Louis Navier <cl@example.com>", "co-authored-by: claude monet"]) {
this.assertEqual(decision(run_hook(this.H, bash("git commit -m \""+message(trailer)+"\""))), "", trailer);
this.assertEqual(decision(run_hook(this.H, bash("git commit -m \"feat: add x\" --trailer \""+trailer+"\""))), "", trailer);
this.assertEqual(decision(run_hook(this.H, bash("gh pr create --title t --body \"Summary\n\n"+trailer+"\""))), "", trailer);
}
for (const trailer of ["Co-Authored-By: Claude <noreply@anthropic.com>", "Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>", "Co-Authored-By: Claude Sonnet 4", "Co-Authored-By: Claude Code", "Co-authored-by: Claude 3.7 Sonnet <x@example.com>", "CO-AUTHORED-BY: CLAUDE", "Co-Authored-By: Monet <x@anthropic.com>"]) {
this.assertEqual(decision(run_hook(this.H, bash("git commit -m \""+message(trailer)+"\""))), "block", trailer);
this.assertEqual(decision(run_hook(this.H, bash("git commit -m \"feat: add x\" --trailer \""+trailer+"\""))), "block", trailer);
}
{const _box=temporaryDirectory();root=_box;try{
writeFileSync(join(root,"person.txt"),message("Co-authored-by: Claude Monet <claude@example.com>\n"));
writeFileSync(join(root,"ai.txt"),message("Co-authored-by: Claude Monet <noreply@anthropic.com>\n"));
this.assertEqual(decision(run_hook(this.H, bash("git commit -F person.txt"), {cwd: root})), "");
this.assertEqual(decision(run_hook(this.H, bash("git commit -F ai.txt"), {cwd: root})), "block");
}finally{removeTree(_box);}}
}
test_line_breaks_made_by_the_shell_are_seen():any{
const trailer="Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>";
for (const command of ["git commit -m $'feat: x\\n\\n"+trailer+"'", "git commit -m $'feat: don\\'t\\n\\n"+trailer+"'", "git commit -m \"$(printf 'feat: x\\n\\n"+trailer+"')\"", "git commit -m \"$(echo -e 'feat: x\\n\\n"+trailer+"')\"", "git commit -m $'feat: x\\r\\n\\r\\n"+trailer+"'", "git commit -m \"feat: x\\n\\n"+trailer+"\"", "gh pr create --title t --body $'Summary\\n\\n\\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)'", "git commit -m $'feat: x\\x0a\\x0a"+trailer+"'", "git commit -m $'feat: x\\012\\012"+trailer+"'"]) {
this.assertEqual(decision(run_hook(this.H, bash(command))), "block", command);
}
for (const command of ["git commit -m $'feat: x\\n\\nCo-authored-by: Claude Monet <claude@example.com>'", "git commit -m \"$(printf 'feat: x\\n\\nCo-authored-by: Claude Debussy <cd@example.com>')\"", "git commit -m $'docs: explain why Co-Authored-By: Claude is banned\\n\\nSee the hook.'", "git commit -m \"docs: the trailer is written \\\"Co-Authored-By: Claude\\\" by default\"", "git commit -m $'feat: don\\'t panic\\n\\nWhy and how.'"]) {
this.assertEqual(decision(run_hook(this.H, bash(command))), "", command);
}
}
test_options_before_the_subcommand_do_not_hide_it():any{
for (const command of ["git -C repo -c user.name=x commit -m \"feat: add x\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\"", "gh -R owner/repo pr create --title t --body \"Summary\n\nGenerated with Claude Code\""]) {
this.assertEqual(decision(run_hook(this.H, bash(command))), "block", command);
}
this.assertEqual(decision(run_hook(this.H, bash("git -C repo log -1 --format=\"Co-Authored-By: Claude\""))), "");
}
test_pr_bodies_with_a_generated_footer_are_blocked():any{
let root:any;
this.assertEqual(decision(run_hook(this.H, bash("gh pr create --title t --body \"Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)\"")) ), "block");
this.assertEqual(decision(run_hook(this.H, bash("gh pr create --title t --body \"Summary only\"")) ), "");
{const _box=temporaryDirectory();root=_box;try{
writeFileSync(join(root,"body.md"),"## Summary\n\nGenerated with Claude Code\n");
this.assertEqual(decision(run_hook(this.H, bash("gh pr create --title t --body-file body.md"), {cwd: root})), "block");
}finally{removeTree(_box);}}
}
}
class TestHookInputDecisionMatrix extends Case {
test_unknown_model_is_a_nonblocking_warning_context():any{
let payload:any,result:any;
(result=run_hook("check_model_versions.js", write("m = \"claude-made-up-9-9\"")));
this.assertEqual(result.returncode, 0);
(payload=JSON.parse(result.stdout));
this.assertIn("hookSpecificOutput", payload);
this.assertIn("additionalContext", at(payload, "hookSpecificOutput"));
this.assertIn("UNKNOWN", at(at(payload, "hookSpecificOutput"), "additionalContext"));
}
test_pr_label_follows_cd_into_another_repository():any{
const box=stub_gh();try{const session=temp_repo(),target=temp_repo();try{mkdirSync(join(target,'.claude'),{recursive:true});writeFileSync(join(target,'.claude/pr-policy.json'),'');
const followed=run_hook("validate_pr_label.js", bash(`cd "${target}" && gh pr create --title x`), {cwd: session, env: box.value});
this.assertEqual(followed.stdout, "");
const stayed=run_hook("validate_pr_label.js", bash("gh pr create --title x"), {cwd: session, env: box.value});
this.assertEqual(decision(stayed), "block");}finally{removeTree(session);removeTree(target);}}finally{removeTree(box.root);}
}
test_pr_label_policy_states_are_block_empty_and_allow():any{
let allowed:any,blocked:any,empty:any,env:any,missing:any,payload:any,policy:any,policy_dir:any,root:any;
(payload=bash("gh pr create --title x"));
{const _box3=stub_gh();env=_box3.value;try{{const _box2=temp_repo();root=_box2;try{(missing=run_hook("validate_pr_label.js", payload, {cwd: root, env: env}));
this.assertEqual(decision(missing), "block");
(policy_dir=join(root,".claude"));
mkdirSync(policy_dir,{recursive:true});
(policy=join(policy_dir,"pr-policy.json"));
writeFileSync(policy,"");
(empty=run_hook("validate_pr_label.js", payload, {cwd: root, env: env}));
this.assertEqual(empty.stdout, "");
writeFileSync(policy,JSON.stringify({"version": 1, "fingerprint": "stale", "observed_prs": 1, "enforced": true, "rules": [{"group": ":", "requirement": "at_least_one", "allowed": [":cat", ":pos"]}]}));
(blocked=run_hook("validate_pr_label.js", bash("gh pr create --title x --label :other"), {cwd: root, env: env}));
this.assertEqual(decision(blocked), "block");
(allowed=run_hook("validate_pr_label.js", bash("gh pr create --title x --label :cat"), {cwd: root, env: env}));
this.assertEqual(allowed.stdout, "");}finally{removeTree(_box2);}}}finally{removeTree(_box3.root);}}
}
}
class TestTheStopHookIsOffByDefault extends Case {
test_nothing_is_committed_without_opt_in():any{
let before:any,result:any,root:any;
{const _box4=temp_repo();root=_box4;try{writeFileSync(join(root,"dirty.txt"),"x\n");
(before=commit_count(root));
(result=run_hook("commit-session.js", null, {cwd: root, env: env_with()}));
this.assertEqual(result.returncode, 0);
this.assertEqual(commit_count(root), before, "commit appeared without opt-in");
this.assertEqual(strip(result.stdout), "");}finally{removeTree(_box4);}}
}
test_the_env_kill_switch_beats_the_marker_file():any{
let before:any,result:any,root:any;

{const _box5=temp_repo();root=_box5;try{mkdirSync(join(root,".claude"),{recursive:true});
writeFileSync(join(join(root,".claude"),"session-autocommit"),"");
writeFileSync(join(root,"dirty.txt"),"x\n");
(before=commit_count(root));
(result=run_hook("commit-session.js", null, {cwd: root, env: env_with({JSTACK_SESSION_AUTOCOMMIT: "0"})}));
this.assertEqual(result.returncode, 0);
this.assertEqual(commit_count(root), before);}finally{removeTree(_box5);}}
}
test_the_guard_is_a_guard_not_a_corpse():any{
let before:any,body:any,path:any,result:any,root:any;

{const _box7=temp_repo();root=_box7;try{{const _box6=stub_claude("chore(probe): 스텁 메시지 추가");path=_box6.value;try{mkdirSync(join(root,".claude"),{recursive:true});
writeFileSync(join(join(root,".claude"),"session-autocommit"),"");
writeFileSync(join(root,"dirty.txt"),"x\n");
(before=commit_count(root));
(result=run_hook("commit-session.js", null, {cwd: root, env: env_with({PATH: path})}));
this.assertEqual(result.returncode, 0);
this.assertEqual(commit_count(root), (before + 1));
(body=git(root, "log", "-1", "--pretty=%B").stdout);
this.assertIn("chore(probe): 스텁 메시지 추가", body);
this.assertIn("Auto-Session-Commit: true", body);}finally{removeTree(_box6.root);}}}finally{removeTree(_box7);}}
}
test_the_env_var_alone_turns_it_on():any{
let before:any,path:any,root:any;
{const _box9=temp_repo();root=_box9;try{{const _box8=stub_claude("chore(probe): 환경변수 경로 추가");path=_box8.value;try{writeFileSync(join(root,"dirty.txt"),"x\n");
(before=commit_count(root));
this.assertEqual(git(root, "config", "user.name", "Repository Owner").returncode, 0);
this.assertEqual(git(root, "config", "user.email", "owner@example.invalid").returncode, 0);
mkdirSync(join(root, "docs"), {recursive: true});
writeFileSync(join(root, "docs", "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
git(root, "add", "-A"); git(root, "commit", "-q", "-m", "docs: add changelog");
(before=commit_count(root));
writeFileSync(join(root,"dirty2.txt"),"y\n");
const ownEnv=env_with({PATH: path, JSTACK_SESSION_AUTOCOMMIT: "1"});
for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete ownEnv[name];
run_hook("commit-session.js", null, {cwd: root, env: ownEnv});
this.assertEqual(commit_count(root), (before + 2));
this.assertEqual(git(root, "log", "-2", "--pretty=%ae %ce").stdout.trim(), "owner@example.invalid owner@example.invalid\nowner@example.invalid owner@example.invalid");}finally{removeTree(_box8.root);}}}finally{removeTree(_box9);}}
}
test_this_repository_did_not_opt_in():any{

this.assertFalse(existsSync(join(join(dirname(dirname(ROOT)),".claude"),"session-autocommit")));
}
test_the_no_verify_bypass_is_documented():any{
let block:any,contract:any,source:any;

(source=readFileSync(join(HOOKS,"commit-session.js"),"utf8"));
this.assertIn("--no-verify", source);
(contract=readFileSync(join(HOOKS,"CONTRACT.md"),"utf8"));
(block=at(split(contract, "\n## commit-session.js", 1), 1));
this.assertIn("--no-verify", block);
this.assertIn("block_emoji.js", block);
this.assertIn("Bash tool", block);
}
}
class TestSessionStartLoadsTheRecentPast extends Case {
test_recent_commits_reach_the_context():any{
let payload:any,result:any,root:any;
{const _box10=temp_repo();root=_box10;try{writeFileSync(join(root,"a.txt"),"a\n");
git(root, "add", "-A");
git(root, "commit", "-q", "-m", "feat: 표식이 되는 커밋 추가");
(result=run_hook("load-recent-changes.js", null, {cwd: root, env: env_with()}));
this.assertEqual(result.returncode, 0);
(payload=JSON.parse(result.stdout));
this.assertIn("표식이 되는 커밋", at(at(payload, "hookSpecificOutput"), "additionalContext"));}finally{removeTree(_box10);}}
}
test_the_changelog_tail_is_included():any{
let payload:any,result:any,root:any;
{const _box11=temp_repo();root=_box11;try{mkdirSync(join(root,"docs"),{recursive:true});
writeFileSync(join(join(root,"docs"),"CHANGELOG.md"),"# CHANGELOG\n\n- 표식이 되는 변경 기록\n");
(result=run_hook("load-recent-changes.js", null, {cwd: root, env: env_with()}));
(payload=JSON.parse(result.stdout));
this.assertIn("표식이 되는 변경 기록", at(at(payload, "hookSpecificOutput"), "additionalContext"));}finally{removeTree(_box11);}}
}
test_it_stays_silent_outside_a_repository_instead_of_dying():any{
let env:any,raw:any,result:any;

{const _box12=temporaryDirectory();raw=_box12;try{(env=env_with());
delete env.CLAUDE_PROJECT_DIR;
(result=run_hook("load-recent-changes.js", null, {cwd: raw, env: env}));
this.assertEqual(result.returncode, 0, result.stderr);
this.assertEqual(strip(result.stdout), "");}finally{removeTree(_box12);}}
}
}
class TestTheReadmeVersionHookStillJudges extends Case {
COMMIT:any={"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}};
test_a_plugin_without_a_readme_blocks_the_commit():any{
let result:any,root:any;
{const _box13=temp_repo();root=_box13;try{seed_plugin(root, {readme: false});
(result=run_hook("check_readme_version.js", this.COMMIT, {cwd: root}));
this.assertEqual(decision(result), "block");
this.assertIn("README.md missing", result.stdout);}finally{removeTree(_box13);}}
}
test_a_stale_root_table_blocks_the_commit():any{
let plugin:any,result:any,root:any;
{const _box14=temp_repo();root=_box14;try{(plugin=seed_plugin(root, {version: "2.0.0"}));
writeFileSync(join(root,"README.md"),"| plugin | version |\n|---|---|\n| probe | 1.0.0 |\n");
git(root, "add", "-A");
this.assertTrue(statSync(plugin).isDirectory());
(result=run_hook("check_readme_version.js", this.COMMIT, {cwd: root}));
this.assertEqual(decision(result), "block");}finally{removeTree(_box14);}}
}
test_a_consistent_plugin_passes():any{
let result:any,root:any;
{const _box15=temp_repo();root=_box15;try{seed_plugin(root);
(result=run_hook("check_readme_version.js", this.COMMIT, {cwd: root}));
this.assertEqual(decision(result), "");}finally{removeTree(_box15);}}
}
test_a_command_that_is_not_a_commit_passes():any{
let result:any,root:any;
{const _box16=temp_repo();root=_box16;try{seed_plugin(root, {readme: false});
(result=run_hook("check_readme_version.js", bash("ls -la"), {cwd: root}));
this.assertEqual(decision(result), "");}finally{removeTree(_box16);}}
}
test_the_block_message_says_warn_and_that_is_a_trap():any{
let block:any,contract:any;

(contract=readFileSync(join(HOOKS,"CONTRACT.md"),"utf8"));
(block=at(split(contract, "\n## check_readme_version.js", 1), 1));
this.assertIn("[WARN]", block);
}
}
class TestTheMarketplaceVersionHookStillJudges extends Case {
PUSH:any={"tool_name": "Bash", "tool_input": {"command": "git push origin HEAD"}};
test_a_version_mismatch_blocks_the_push():any{
let result:any,root:any;
{const _box17=temp_repo();root=_box17;try{seed_plugin(root, {version: "1.0.0", marketplace_version: "9.9.9"});
(result=run_hook("check_marketplace_versions.js", this.PUSH, {cwd: root}));
this.assertEqual(decision(result), "block");
this.assertIn("9.9.9", result.stdout);}finally{removeTree(_box17);}}
}
test_matching_versions_pass():any{
let result:any,root:any;
{const _box18=temp_repo();root=_box18;try{seed_plugin(root, {version: "1.0.0"});
(result=run_hook("check_marketplace_versions.js", this.PUSH, {cwd: root}));
this.assertEqual(decision(result), "");}finally{removeTree(_box18);}}
}
test_a_command_that_is_not_a_push_passes():any{
let result:any,root:any;
{const _box19=temp_repo();root=_box19;try{seed_plugin(root, {version: "1.0.0", marketplace_version: "9.9.9"});
(result=run_hook("check_marketplace_versions.js", bash("ls"), {cwd: root}));
this.assertEqual(decision(result), "");}finally{removeTree(_box19);}}
}
}
class TestValidateBeforePublishReadsStdinNotTheEnvironment extends Case {
PUBLISH:any={"tool_name": "Bash", "tool_input": {"command": "bash scripts/register_local.sh /nonexistent/plugin"}};
test_a_missing_plugin_directory_is_blocked():any{
let result:any;
(result=run_hook("validate_before_publish.js", this.PUBLISH));
this.assertEqual(result.returncode, 1);
this.assertIn("[BLOCK]", result.stdout);
}
test_a_poisoned_tool_name_env_var_does_not_disable_it():any{
let result:any;

(result=run_hook("validate_before_publish.js", this.PUBLISH, {env: {...process.env,"TOOL_NAME":"unknown","TOOL_PARAMS":""}}));
this.assertEqual(result.returncode, 1);
}
seed_validator(root:string,code:number){const target=join(root,'skills/author/scripts/validate_plugin.js');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,`console.log('[FAIL] probe');process.exitCode=${code};`);return target;}
test_a_passing_validator_lets_the_publish_through():any{
let payload:any,plugin:any,result:any,root:any;

{const _box20=temp_repo();root=_box20;try{(plugin=seed_plugin(root));
this.seed_validator(root, 0);
(payload=bash(("bash scripts/register_local.sh " + pyStr(plugin))));
(result=run_hook("validate_before_publish.js", payload, {cwd: root}));
this.assertEqual(result.returncode, 0);
this.assertIn("[HOOK] Pre-publish format validation", result.stdout);
this.assertIn("Validation passed", result.stdout);}finally{removeTree(_box20);}}
}
test_quoted_space_path_is_checked_like_a_plain_path_in_a_compound_command():any{
let command:any,plain:any,result:any,root:any,spaced:any;

{const _box21=temp_repo();root=_box21;try{(plain=join(root,"plain-plugin"));
(spaced=join(root,"plugin with spaces"));
mkdirSync(plain,{recursive:true});
mkdirSync(spaced,{recursive:true});
this.seed_validator(root, 0);
for (let command of [("cd / && bash scripts/register_local.sh " + pyStr(plain)), ("cd / && bash scripts/register_local.sh \"" + pyStr(spaced) + "\"")]) {
(result=run_hook("validate_before_publish.js", bash(command), {cwd: root}));
this.assertEqual(result.returncode, 0, result.stdout);
this.assertIn("Validation passed", result.stdout);
}}finally{removeTree(_box21);}}
}
test_relative_target_after_cd_uses_the_compound_command_working_directory():any{
let plugin:any,result:any,root:any,workspace:any;
{const _box22=temp_repo();root=_box22;try{(workspace=join(root,"workspace"));
(plugin=join(workspace,"relative-plugin"));
mkdirSync(plugin,{recursive:true});
this.seed_validator(root, 0);
(result=run_hook("validate_before_publish.js", bash("cd workspace && bash scripts/register_local.sh relative-plugin"), {cwd: root}));
this.assertEqual(result.returncode, 0, result.stdout);
this.assertIn(pyStr(plugin), result.stdout);}finally{removeTree(_box22);}}
}
test_unrelated_command_substitution_remains_a_silent_noop():any{
let result:any;
(result=run_hook("validate_before_publish.js", bash("echo $(date)")));
this.assertEqual(result.returncode, 0);
this.assertEqual(result.stdout, "");
}
test_malformed_publish_target_is_blocked_without_executing_shell_text():any{
let command:any,commands:any,marker:any,raw:any,result:any;

{const _box23=temporaryDirectory();raw=_box23;try{(marker=join(raw,"should-not-exist"));
(commands=["bash scripts/register_local.js", ("bash scripts/register_local.sh; touch \"" + pyStr(marker) + "\""), "bash scripts/register_local.sh \"unterminated", ("bash scripts/register_local.sh \"$(touch " + pyStr(marker) + ")\"")]);
for (let command of commands) {
(result=run_hook("validate_before_publish.js", bash(command), {cwd: raw}));
this.assertEqual(result.returncode, 1, result.stdout);
this.assertIn("Could not safely parse", result.stdout);
}
this.assertFalse(existsSync(marker));}finally{removeTree(_box23);}}
}
test_a_failing_validator_blocks_the_publish():any{
let payload:any,plugin:any,result:any,root:any;
{const _box24=temp_repo();root=_box24;try{(plugin=seed_plugin(root));
this.seed_validator(root, 1);
(payload=bash(("bash scripts/register_local.sh " + pyStr(plugin))));
(result=run_hook("validate_before_publish.js", payload, {cwd: root}));
this.assertEqual(result.returncode, 1);
this.assertIn("[BLOCK] Validation failed", result.stdout);
this.assertIn("Reproduce manually", result.stdout);}finally{removeTree(_box24);}}
}
test_a_missing_validator_blocks_rather_than_passes():any{
let payload:any,plugin:any,result:any,root:any;

{const _box25=temp_repo();root=_box25;try{(plugin=seed_plugin(root));
(payload=bash(("bash scripts/register_local.sh " + pyStr(plugin))));
(result=run_hook("validate_before_publish.js", payload, {cwd: root}));
this.assertEqual(result.returncode, 1);
this.assertIn("Format validator not found", result.stdout);}finally{removeTree(_box25);}}
}
test_an_unrelated_command_is_silent():any{
let result:any;
(result=run_hook("validate_before_publish.js", bash("ls -la")));
this.assertEqual(result.returncode, 0);
this.assertEqual(result.stdout, "");
}
test_a_non_bash_tool_is_silent():any{
let result:any;
(result=run_hook("validate_before_publish.js", write("x = 1")));
this.assertEqual(result.returncode, 0);
}
test_unparseable_input_does_not_crash():any{
let result:any;
(result=subprocessRun([process.execPath, join(HOOKS,"validate_before_publish.js")],{input:"not json at all",capture_output:true,text:true,timeout:120}));
this.assertEqual(result.returncode, 0);
}
test_the_plugin_relative_validator_is_documented():any{
let block:any,contract:any;

(contract=readFileSync(join(HOOKS,"CONTRACT.md"),"utf8"));
(block=at(split(contract, "\n## validate_before_publish.js", 1), 1));
this.assertIn("plugin-relative", block);
this.assertIn("skills/author/scripts/validate_plugin.js", block);
}
}
test('TestTheHooksArrived.test_every_inherited_hook_is_present',()=>{const c=new TestTheHooksArrived();c.test_every_inherited_hook_is_present();});
test('TestTheHooksArrived.test_the_model_database_is_in_scripts',()=>{const c=new TestTheHooksArrived();c.test_the_model_database_is_in_scripts();});
test('TestTheHooksArrived.test_hooks_json_registers_every_hook',()=>{const c=new TestTheHooksArrived();c.test_hooks_json_registers_every_hook();});
test('TestTheHooksArrived.test_plugin_root_is_quoted_for_space_safe_hook_execution',()=>{const c=new TestTheHooksArrived();c.test_plugin_root_is_quoted_for_space_safe_hook_execution();});
test('TestTheHooksArrived.test_the_chain_order_follows_the_ledger',()=>{const c=new TestTheHooksArrived();c.test_the_chain_order_follows_the_ledger();});
test('TestTheHooksArrived.test_every_event_declared_is_the_event_present',()=>{const c=new TestTheHooksArrived();c.test_every_event_declared_is_the_event_present();});
test('TestTheHooksArrived.test_the_stop_hook_is_async_with_a_timeout',()=>{const c=new TestTheHooksArrived();c.test_the_stop_hook_is_async_with_a_timeout();});
test('TestTheHooksArrived.test_session_start_only_fires_on_startup',()=>{const c=new TestTheHooksArrived();c.test_session_start_only_fires_on_startup();});
test('TestTheHooksArrived.test_every_hook_has_a_contract_block',()=>{const c=new TestTheHooksArrived();c.test_every_hook_has_a_contract_block();});
test('TestNoEmojiSurvivedTheMigration.test_no_hook_emits_an_emoji',()=>{const c=new TestNoEmojiSurvivedTheMigration();c.test_no_hook_emits_an_emoji();});
test('TestNoEmojiSurvivedTheMigration.test_the_signal_survived_as_a_word',()=>{const c=new TestNoEmojiSurvivedTheMigration();c.test_the_signal_survived_as_a_word();});
test('TestTheModelCheckerStillJudges.test_a_retired_model_is_blocked',()=>{const c=new TestTheModelCheckerStillJudges();c.test_a_retired_model_is_blocked();});
test('TestTheModelCheckerStillJudges.test_the_four_series_boundary_holds',()=>{const c=new TestTheModelCheckerStillJudges();c.test_the_four_series_boundary_holds();});
test('TestTheModelCheckerStillJudges.test_the_latest_gemini_passes',()=>{const c=new TestTheModelCheckerStillJudges();c.test_the_latest_gemini_passes();});
test('TestTheModelCheckerStillJudges.test_an_unknown_model_is_named',()=>{const c=new TestTheModelCheckerStillJudges();c.test_an_unknown_model_is_named();});
test('TestModelFindingsInDocumentsAreAdvisory.test_a_markdown_document_warns_without_blocking',()=>{const c=new TestModelFindingsInDocumentsAreAdvisory();c.test_a_markdown_document_warns_without_blocking();});
test('TestModelFindingsInDocumentsAreAdvisory.test_a_file_outside_the_project_warns_without_blocking',()=>{const c=new TestModelFindingsInDocumentsAreAdvisory();c.test_a_file_outside_the_project_warns_without_blocking();});
test('TestModelFindingsInDocumentsAreAdvisory.test_project_code_still_blocks',()=>{const c=new TestModelFindingsInDocumentsAreAdvisory();c.test_project_code_still_blocks();});
test('TestModelFindingsInDocumentsAreAdvisory.test_bash_still_blocks',()=>{const c=new TestModelFindingsInDocumentsAreAdvisory();c.test_bash_still_blocks();});
test('TestModelFindingsInDocumentsAreAdvisory.test_superseded_models_point_to_current_successors',()=>{const c=new TestModelFindingsInDocumentsAreAdvisory();c.test_superseded_models_point_to_current_successors();});
test('TestBashChecksModelSelectionNotMentions.test_a_command_that_only_mentions_a_model_passes',()=>{const c=new TestBashChecksModelSelectionNotMentions();c.test_a_command_that_only_mentions_a_model_passes();});
test('TestBashChecksModelSelectionNotMentions.test_a_command_that_writes_a_model_name_warns_without_blocking',()=>{const c=new TestBashChecksModelSelectionNotMentions();c.test_a_command_that_writes_a_model_name_warns_without_blocking();});
test('TestBashChecksModelSelectionNotMentions.test_a_command_that_selects_a_model_still_blocks',()=>{const c=new TestBashChecksModelSelectionNotMentions();c.test_a_command_that_selects_a_model_still_blocks();});
test('TestBashChecksModelSelectionNotMentions.test_a_profile_path_is_not_a_model',()=>{const c=new TestBashChecksModelSelectionNotMentions();c.test_a_profile_path_is_not_a_model();});
test('TestTheModelCheckerStillJudges.test_a_broken_database_path_is_reported_not_silent',()=>{const c=new TestTheModelCheckerStillJudges();c.test_a_broken_database_path_is_reported_not_silent();});
test('TestTheUvHookStillJudges.test_pip_is_blocked',()=>{const c=new TestTheUvHookStillJudges();c.test_pip_is_blocked();});
test('TestTheUvHookStillJudges.test_uv_add_passes',()=>{const c=new TestTheUvHookStillJudges();c.test_uv_add_passes();});
test('TestTheUvHookStillJudges.test_an_unrelated_command_passes',()=>{const c=new TestTheUvHookStillJudges();c.test_an_unrelated_command_passes();});
test('TestTheUvHookStillJudges.test_uv_pip_install_without_a_venv_is_blocked',()=>{const c=new TestTheUvHookStillJudges();c.test_uv_pip_install_without_a_venv_is_blocked();});
test('TestTheAttributionHookBlocksAiTrailers.test_quoted_mentions_and_clean_commits_pass',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_quoted_mentions_and_clean_commits_pass();});
test('TestTheAttributionHookBlocksAiTrailers.test_a_trailer_in_dash_m_is_blocked_with_the_phrase_to_remove',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_a_trailer_in_dash_m_is_blocked_with_the_phrase_to_remove();});
test('TestTheAttributionHookBlocksAiTrailers.test_the_default_heredoc_form_is_blocked',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_the_default_heredoc_form_is_blocked();});
test('TestTheAttributionHookBlocksAiTrailers.test_dash_f_files_and_stdin_heredocs_are_read',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_dash_f_files_and_stdin_heredocs_are_read();});
test('TestTheAttributionHookBlocksAiTrailers.test_amend_without_a_new_message_checks_the_reused_message',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_amend_without_a_new_message_checks_the_reused_message();});
test('TestTheAttributionHookBlocksAiTrailers.test_trailer_matching_ignores_case_and_colon_spacing',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_trailer_matching_ignores_case_and_colon_spacing();});
test('TestTheAttributionHookBlocksAiTrailers.test_relative_message_files_follow_cd_and_git_dash_c',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_relative_message_files_follow_cd_and_git_dash_c();});
test('TestTheAttributionHookBlocksAiTrailers.test_the_payload_cwd_is_where_relative_message_files_resolve',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_the_payload_cwd_is_where_relative_message_files_resolve();});
test('TestTheAttributionHookBlocksAiTrailers.test_trailer_flag_values_are_checked',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_trailer_flag_values_are_checked();});
test('TestTheAttributionHookBlocksAiTrailers.test_stdin_that_is_not_a_heredoc_is_reported_not_passed',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_stdin_that_is_not_a_heredoc_is_reported_not_passed();});
test('TestTheAttributionHookBlocksAiTrailers.test_only_a_line_that_starts_with_the_phrase_counts',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_only_a_line_that_starts_with_the_phrase_counts();});
test('TestTheAttributionHookBlocksAiTrailers.test_shell_wrappers_with_a_clustered_c_flag_are_read',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_shell_wrappers_with_a_clustered_c_flag_are_read();});
test('TestTheAttributionHookBlocksAiTrailers.test_a_long_clustered_flag_word_does_not_stall',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_a_long_clustered_flag_word_does_not_stall();});
test('TestTheAttributionHookBlocksAiTrailers.test_human_co_authors_named_claude_pass_and_ai_names_do_not',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_human_co_authors_named_claude_pass_and_ai_names_do_not();});
test('TestTheAttributionHookBlocksAiTrailers.test_line_breaks_made_by_the_shell_are_seen',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_line_breaks_made_by_the_shell_are_seen();});
test('TestTheAttributionHookBlocksAiTrailers.test_options_before_the_subcommand_do_not_hide_it',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_options_before_the_subcommand_do_not_hide_it();});
test('TestTheAttributionHookBlocksAiTrailers.test_pr_bodies_with_a_generated_footer_are_blocked',()=>{const c=new TestTheAttributionHookBlocksAiTrailers();c.test_pr_bodies_with_a_generated_footer_are_blocked();});
test('TestHookInputDecisionMatrix.test_unknown_model_is_a_nonblocking_warning_context',()=>{const c=new TestHookInputDecisionMatrix();c.test_unknown_model_is_a_nonblocking_warning_context();});
test('TestHookInputDecisionMatrix.test_pr_label_follows_cd_into_another_repository',()=>{const c=new TestHookInputDecisionMatrix();c.test_pr_label_follows_cd_into_another_repository();});
test('TestHookInputDecisionMatrix.test_pr_label_policy_states_are_block_empty_and_allow',()=>{const c=new TestHookInputDecisionMatrix();c.test_pr_label_policy_states_are_block_empty_and_allow();});
test('TestTheStopHookIsOffByDefault.test_nothing_is_committed_without_opt_in',()=>{const c=new TestTheStopHookIsOffByDefault();c.test_nothing_is_committed_without_opt_in();});
test('TestTheStopHookIsOffByDefault.test_the_env_kill_switch_beats_the_marker_file',()=>{const c=new TestTheStopHookIsOffByDefault();c.test_the_env_kill_switch_beats_the_marker_file();});
test('TestTheStopHookIsOffByDefault.test_the_guard_is_a_guard_not_a_corpse',()=>{const c=new TestTheStopHookIsOffByDefault();c.test_the_guard_is_a_guard_not_a_corpse();});
test('TestTheStopHookIsOffByDefault.test_the_env_var_alone_turns_it_on',()=>{const c=new TestTheStopHookIsOffByDefault();c.test_the_env_var_alone_turns_it_on();});
test('TestTheStopHookIsOffByDefault.test_this_repository_did_not_opt_in',()=>{const c=new TestTheStopHookIsOffByDefault();c.test_this_repository_did_not_opt_in();});
test('TestTheStopHookIsOffByDefault.test_the_no_verify_bypass_is_documented',()=>{const c=new TestTheStopHookIsOffByDefault();c.test_the_no_verify_bypass_is_documented();});
test('TestSessionStartLoadsTheRecentPast.test_recent_commits_reach_the_context',()=>{const c=new TestSessionStartLoadsTheRecentPast();c.test_recent_commits_reach_the_context();});
test('TestSessionStartLoadsTheRecentPast.test_the_changelog_tail_is_included',()=>{const c=new TestSessionStartLoadsTheRecentPast();c.test_the_changelog_tail_is_included();});
test('TestSessionStartLoadsTheRecentPast.test_it_stays_silent_outside_a_repository_instead_of_dying',()=>{const c=new TestSessionStartLoadsTheRecentPast();c.test_it_stays_silent_outside_a_repository_instead_of_dying();});
test('TestTheReadmeVersionHookStillJudges.test_a_plugin_without_a_readme_blocks_the_commit',()=>{const c=new TestTheReadmeVersionHookStillJudges();c.test_a_plugin_without_a_readme_blocks_the_commit();});
test('TestTheReadmeVersionHookStillJudges.test_a_stale_root_table_blocks_the_commit',()=>{const c=new TestTheReadmeVersionHookStillJudges();c.test_a_stale_root_table_blocks_the_commit();});
test('TestTheReadmeVersionHookStillJudges.test_a_consistent_plugin_passes',()=>{const c=new TestTheReadmeVersionHookStillJudges();c.test_a_consistent_plugin_passes();});
test('TestTheReadmeVersionHookStillJudges.test_a_command_that_is_not_a_commit_passes',()=>{const c=new TestTheReadmeVersionHookStillJudges();c.test_a_command_that_is_not_a_commit_passes();});
test('TestTheReadmeVersionHookStillJudges.test_the_block_message_says_warn_and_that_is_a_trap',()=>{const c=new TestTheReadmeVersionHookStillJudges();c.test_the_block_message_says_warn_and_that_is_a_trap();});
test('TestTheMarketplaceVersionHookStillJudges.test_a_version_mismatch_blocks_the_push',()=>{const c=new TestTheMarketplaceVersionHookStillJudges();c.test_a_version_mismatch_blocks_the_push();});
test('TestTheMarketplaceVersionHookStillJudges.test_matching_versions_pass',()=>{const c=new TestTheMarketplaceVersionHookStillJudges();c.test_matching_versions_pass();});
test('TestTheMarketplaceVersionHookStillJudges.test_a_command_that_is_not_a_push_passes',()=>{const c=new TestTheMarketplaceVersionHookStillJudges();c.test_a_command_that_is_not_a_push_passes();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_a_missing_plugin_directory_is_blocked',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_a_missing_plugin_directory_is_blocked();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_a_poisoned_tool_name_env_var_does_not_disable_it',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_a_poisoned_tool_name_env_var_does_not_disable_it();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_a_passing_validator_lets_the_publish_through',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_a_passing_validator_lets_the_publish_through();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_quoted_space_path_is_checked_like_a_plain_path_in_a_compound_command',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_quoted_space_path_is_checked_like_a_plain_path_in_a_compound_command();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_relative_target_after_cd_uses_the_compound_command_working_directory',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_relative_target_after_cd_uses_the_compound_command_working_directory();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_unrelated_command_substitution_remains_a_silent_noop',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_unrelated_command_substitution_remains_a_silent_noop();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_malformed_publish_target_is_blocked_without_executing_shell_text',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_malformed_publish_target_is_blocked_without_executing_shell_text();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_a_failing_validator_blocks_the_publish',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_a_failing_validator_blocks_the_publish();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_a_missing_validator_blocks_rather_than_passes',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_a_missing_validator_blocks_rather_than_passes();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_an_unrelated_command_is_silent',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_an_unrelated_command_is_silent();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_a_non_bash_tool_is_silent',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_a_non_bash_tool_is_silent();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_unparseable_input_does_not_crash',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_unparseable_input_does_not_crash();});
test('TestValidateBeforePublishReadsStdinNotTheEnvironment.test_the_plugin_relative_validator_is_documented',()=>{const c=new TestValidateBeforePublishReadsStdinNotTheEnvironment();c.test_the_plugin_relative_validator_is_documented();});
