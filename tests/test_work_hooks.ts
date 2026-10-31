/** Native owning cases for registration, matcher branches, and defective ZIP gates. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {zipSync} from 'fflate';
import {runProcess} from '../runtime/os.js';
import {EXPECTED_ORDER} from '../scripts/check_hook_order.js';
import {POLICIES} from '../hosts/claude/hooks/hook-policies.js';
import {truth,length,contains,repr,at,slice,strip,split,lines,search,match,findall,group,sorted,temporaryDirectory,removeTree} from '../skills/_suite_lib_native.js';
import {exit_if_timed_out} from '../skills/_suite_lib.js';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),HOOKS=join(ROOT,'hooks'),HOOK=join(HOOKS,'block_emoji.js'),DISPATCH=join(HOOKS,'dispatch.js'),GUARD=join(ROOT,'skills/hwpx/hooks/hwpx_guard.js'),CONTRACT=join(HOOKS,'CONTRACT.md'),HOOKS_JSON=join(HOOKS,'hooks.json'),CHECK_LOAD=join(ROOT,'scripts/check_hook_order.js');
const CHAIN=['dispatch.js'],EMOJI='\u2705',HEAD_NS='http://www.hancom.co.kr/hwpml/2011/head',CLEAN_HEADER=`<hh:head xmlns:hh="${HEAD_NS}"/>`,BORDERED_HEADER=`<hh:head xmlns:hh="${HEAD_NS}"><hh:borderFill id="2"><hh:leftBorder type="SOLID"/></hh:borderFill><hh:charPr borderFillIDRef="2"/></hh:head>`;
function isfile(path:string){try{return statSync(path).isFile();}catch{return false;}}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function toSet(value:any=[]):Set<any>{return new Set(value&&typeof value[Symbol.iterator]==='function'?value:Object.keys(value));}
const str='string',list='list';
function hooks_document():any{return JSON.parse(readFileSync(HOOKS_JSON,'utf8'));}
function hookName(command:string):string{return command.match(/\/([^/"']+)["'](?:\s|$)/)?.[1]??command.split('/').at(-1)?.replace(/["']/g,'')??'';}
function registeredHookNames():Set<string>{const names=new Set<string>();for(const groups of Object.values(hooks_document().hooks) as any[])for(const group of groups)for(const hook of group.hooks??[])names.add(hookName(hook.command));return names;}
function fired_order():any{return Object.fromEntries(Object.entries(hooks_document().hooks).map(([event,entries]:[string,any])=>[event,entries.flatMap((entry:any)=>entry.hooks.map((hook:any)=>hookName(hook.command)))]));}
function run(payload:any,script=HOOK,options:{raw?:string}={}){const result=runProcess(process.execPath,[script],{input:options.raw??JSON.stringify(payload),timeout:120000});exit_if_timed_out(result,script);return {returncode:result.status,stdout:result.stdout,stderr:result.stderr};}
function decision(result:any){return result.stdout.trim()?(JSON.parse(result.stdout).decision??null):null;}
function blocked(payload:any){const result=runProcess(process.execPath,[DISPATCH,'PreToolUse'],{input:JSON.stringify(payload),timeout:120000});exit_if_timed_out(result,'dispatch');return result.status===0&&!!result.stdout.trim()&&JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision==='deny';}
function guard_says_block(payload:any){return decision(run(payload,GUARD))==='block';}
function write_hwpx(path:string,options:any={}){const {mimetype_first=true,stored=true,mimetype='application/hwp+zip',header=CLEAN_HEADER,section=true,preview=null}=options;const entries:any={};const mime=()=>{entries.mimetype=[Buffer.from(mimetype),{level:stored?0:6}];};if(mimetype_first)mime();if(header!==null)entries['Contents/header.xml']=Buffer.from(header);if(section)entries['Contents/section0.xml']=Buffer.from('<sec/>');if(preview!==null)entries['Preview/PrvImage.png']=preview;if(!mimetype_first)mime();writeFileSync(path,zipSync(entries));return path;}
class Case{
 dir=temporaryDirectory();close(){removeTree(this.dir);}
 assertEqual(a:any,b:any,message?:string){assert.deepEqual(a,b,message);}
 assertNotEqual(a:any,b:any,message?:string){assert.notDeepEqual(a,b,message);}
 assertTrue(value:any,message?:string){assert.ok(truth(value),message);}
 assertFalse(value:any,message?:string){assert.ok(!truth(value),message);}
 assertIn(needle:any,value:any,message?:string){assert.ok(contains(value,needle),message??`${pyStr(needle)} absent from ${pyStr(value)}`);}
 assertNotIn(needle:any,value:any,message?:string){assert.ok(!contains(value,needle),message);}
 assertLessEqual(a:any,b:any,message?:string){assert.ok(a instanceof Set&&b instanceof Set?[...a].every(v=>b.has(v)):a<=b,message);}
 assertIsInstance(value:any,type:string){assert.ok(type==='list'?Array.isArray(value):typeof value===type);}
 assertIsNone(value:any,message?:string){assert.equal(value,null,message);}
 assertIsNotNone(value:any,message?:string){assert.notEqual(value,null,message);}
 fail(message:string){assert.fail(message);}
}
class TestTheHookArrived extends Case {
test_the_hook_file_is_present():any{
this.assertTrue(isfile(HOOK), "hooks.json points to a missing file");
this.assertTrue(isfile(DISPATCH), "hooks.json points to a missing dispatcher");
}
test_hooks_json_registers_it():any{
this.assertIn("dispatch.js", JSON.stringify(hooks_document()));
this.assertTrue(POLICIES.some(policy=>policy.replaces.includes('hooks/block_emoji.js')));
}
test_the_guard_file_is_present():any{

this.assertTrue(isfile(GUARD), "hooks.json points to a missing file");
}
test_hooks_json_registers_the_guard():any{
this.assertIn("dispatch.js", JSON.stringify(hooks_document()));
this.assertTrue(POLICIES.some(policy=>policy.replaces.includes('skills/hwpx/hooks/hwpx_guard.js')));
}
test_the_contract_declares_the_required_fields():any{
let block:any,blocks:any,declared:any,group:any,groups:any,hook:any,line:any,registered:any;

(registered=registeredHookNames());
for (let name of registered) {
const section=readFileSync(CONTRACT,'utf8').split(new RegExp(`^## ${name.replaceAll('.','\\.')}\\b`,'m'))[1]?.split(/^## /m)[0]??'';
const blocks=findall("(?s)"+"```contract\\n(.*?)```",section);
this.assertEqual(length(blocks),1,`${name} needs one active contract fence`);
const block=blocks[0];
(declared=new Set(Array.from(lines(block)).filter((line: any) => truth(((contains(line, ":"))))).map((line: any) => (strip(at(split(line, ":"), 0))))));
this.assertLessEqual(new Set(["matcher", "block when", "exit contract"]), declared);
this.assertIn("fail-open", declared, "fail-open status cannot be empty");
}
}
test_the_contract_names_every_registered_hook():any{
let group:any,groups:any,h:any,name:any,registered:any,text:any;
(text=readFileSync(CONTRACT,"utf8"));
(registered=registeredHookNames());
for (let name of registered) {
this.assertIn(("## " + name), text, (pyStr(name) + " is registered without a contract"));
}
}
}
class TestTheHooksJsonSchema extends Case {
TOP_KEYS:any=new Set(["hooks"]);
ENTRY_KEYS:any=new Set(["matcher", "hooks"]);
HOOK_KEYS:any=new Set(["type", "command", "async", "timeout"]);
EVENTS:any=new Set(["PreToolUse", "PostToolUse", "Stop", "SessionStart", "SubagentStop", "UserPromptSubmit", "Notification", "PreCompact", "SessionEnd"]);
test_no_fields_the_host_does_not_know():any{
let document:any,entries:any,entry:any,event:any,hook:any;
(document=hooks_document());
this.assertLessEqual(toSet(document), this.TOP_KEYS, "unknown top-level field");
for (let [event, entries] of Object.entries(at(document, "hooks")) as [string,any][]) {
this.assertIn(event, this.EVENTS, (pyStr(event) + " is not a hook event"));
this.assertIsInstance(entries, list);
for (let entry of entries) {
this.assertLessEqual(toSet(entry), this.ENTRY_KEYS);
this.assertIsInstance(at(entry, "matcher"), str);
this.assertTrue(at(entry, "hooks"), "an empty hook array is not registration");
for (let hook of at(entry, "hooks")) {
this.assertLessEqual(toSet(hook), this.HOOK_KEYS);
this.assertEqual(at(hook, "type"), "command");
this.assertIsInstance(at(hook, "command"), str);
}
}
}
}
test_every_registered_command_points_at_a_real_file():any{
let command:any,entries:any,entry:any,event:any,hook:any,script:any,tail:any;

for (let [event, entries] of Object.entries(at(hooks_document(), "hooks")) as [string,any][]) {
for (let entry of entries) {
for (let hook of at(entry, "hooks")) {
(command=at(hook, "command"));
this.assertIn("${CLAUDE_PLUGIN_ROOT}/", command);
(tail=at(split(command, "${CLAUDE_PLUGIN_ROOT}/", 1), 1));
(script=join(ROOT,strip(at(split(tail), 0), "\"'")));
this.assertTrue(isfile(script), (pyStr(event) + ": points to an unregistered file"));
}
}
}
}
test_the_guard_matcher_matches_its_own_declaration():any{
let declared:any,entry:any,registered:any;

(declared=search("\"matcher\":\\s*\"([^\"]+)\"", readFileSync(GUARD,"utf8")));
this.assertIsNotNone(declared, "guard docstring lost its registration example");
const matcher=at(at(at(hooks_document(),"hooks"),"PreToolUse"),0).matcher;
this.assertTrue(group(declared,1).split('|').every((tool:string)=>matcher.split('|').includes(tool)));
this.assertTrue(POLICIES.some(policy=>policy.id==='hwpx'));
}
}
class TestTheChainOrder extends Case {
RELATIVE:any="hooks/hooks.json";
expected_order(){assert.ok(isfile(CHECK_LOAD));return EXPECTED_ORDER['hooks/hooks.json'];}
test_the_measured_order_is_the_declared_one():any{
let name:any;
this.assertEqual(Array.from(at(fired_order(), "PreToolUse")).filter((name: any) => truth(((contains(CHAIN, name))))).map((name: any) => (name)), CHAIN);
}
test_declared_events_are_exactly_these():any{

this.assertLessEqual(new Set(["PreToolUse", "SessionStart"]), toSet(fired_order()));
}
test_the_gate_declares_no_event_this_file_lacks():any{
let expected:any;
(expected=this.expected_order());
this.assertLessEqual(toSet(fired_order()), toSet(expected), "record per-event order in check_load.EXPECTED_ORDER");
}
test_the_order_agrees_with_check_load():any{
let event:any,expected:any,measured:any,n:any,seen:any,want:any;

(expected=this.expected_order());
(measured=fired_order());
for (let [event, want] of Object.entries(expected)) {
(seen=Array.from((measured[event] ?? [])).filter((n: any) => truth(((contains(want, n))))).map((n: any) => (n)));
this.assertEqual(seen, want);
}
}
test_the_gate_declares_no_hook_that_is_gone():any{
let event:any,expected:any,measured:any,want:any;

(expected=this.expected_order());
(measured=fired_order());
for (let [event, want] of Object.entries(expected)) {
this.assertLessEqual(toSet(want), toSet((measured[event] ?? [])));
}
}
}
class TestMatcherMatchesTheCode extends Case {
matcher_tools():any{
let document:any,entry:any,tools:any;
(document=JSON.parse(readFileSync(join(HOOKS,"hooks.json"),"utf8")));
(tools=toSet());
for (let entry of at(at(document, "hooks"), "PreToolUse")) {
if(truth(((contains(JSON.stringify(entry), "dispatch.js"))))) {
tools=new Set([...tools,...toSet(split(at(entry, "matcher"), "|"))]);
}
}
return tools;
}
PAYLOAD:any={"Write": {"tool_input": {"content": ("# 완료 " + pyStr(EMOJI))}}, "Edit": {"tool_input": {"new_string": ("# 완료 " + pyStr(EMOJI))}}, "MultiEdit": {"tool_input": {"edits": [{"new_string": "ok"}, {"new_string": ("# 완료 " + pyStr(EMOJI))}]}}, "NotebookEdit": {"tool_input": {"new_source": ("# 완료 " + pyStr(EMOJI))}}, "Bash": {"tool_input": {"command": ("echo \"# 완료 " + pyStr(EMOJI) + "\" > /tmp/probe.js")}}};
test_every_tool_in_the_matcher_is_actually_read():any{
let payload:any,tool:any;
for (let tool of sorted(Object.keys(this.PAYLOAD))) {
this.assertIn(tool,this.matcher_tools());
this.assertIn(tool, this.PAYLOAD, ("matcher contains " + pyStr(tool) + ", but this test lacks its payload; add the branch and fixture together"));
(payload={"tool_name":tool,...at(this.PAYLOAD, tool)});
this.assertTrue(blocked(payload), (pyStr(tool) + " is in the matcher but passed; its branch is missing"));
}
}
test_notebook_edit_is_covered():any{

this.assertTrue(blocked({"tool_name": "NotebookEdit", "tool_input": {"new_source": ("x = 1  # " + pyStr(EMOJI))}}));
}
}
class TestTheExitContract extends Case {
test_blocking_exits_zero_and_speaks_on_stdout():any{
let result:any;
(result=run({"tool_name": "Write", "tool_input": {"content": (pyStr(EMOJI))}}));
this.assertEqual(result.returncode, 0, "blocking does not use a nonzero exit");
this.assertEqual(at(JSON.parse(result.stdout), "decision"), "block");
}
test_the_reason_names_the_offending_character():any{
let result:any;
(result=run({"tool_name": "Write", "tool_input": {"content": (pyStr(EMOJI))}}));
this.assertIn("2705", at(JSON.parse(result.stdout), "reason"));
}
}
class TestBashWritesAreCovered extends Case {
SHAPES:any={"redirect": ("echo \"완료 " + pyStr(EMOJI) + "\" > /tmp/a.js"), "append": ("echo \"" + pyStr(EMOJI) + "\" >> /tmp/a.js"), "printf": ("printf \"" + pyStr(EMOJI) + "\" > /tmp/a.js"), "heredoc": ("cat > /tmp/a.py <<EOF\n" + pyStr(EMOJI) + "\nEOF"), "quoted heredoc": ("cat > /tmp/a.md <<'EOF'\n" + pyStr(EMOJI) + "\nEOF"), "sed -i": ("sed -i \"\" \"s/x/" + pyStr(EMOJI) + "/\" /tmp/a.js"), "tee": ("echo \"" + pyStr(EMOJI) + "\" | tee /tmp/a.js")};
test_every_write_shape_is_caught():any{
let command:any,name:any;
for (let [name, command] of Object.entries(this.SHAPES)) {
this.assertTrue(blocked({"tool_name": "Bash", "tool_input": {"command": command}}), ("emoji leaks through the " + pyStr(name) + " form"));
}
}
}
class TestWhatItDoesNotBlock extends Case {
test_korean_and_ascii_markers_pass():any{
let clean:any;
(clean="# 완료 [OK] -> 다음 단계, 한글은 대상이 아니다");
this.assertFalse(blocked({"tool_name": "Write", "tool_input": {"content": clean}}));
}
test_read_only_bash_commands_pass():any{
let command:any;

for (let command of [("grep \"" + pyStr(EMOJI) + "\" /tmp/a.js"), ("grep \"" + pyStr(EMOJI) + "\" /tmp/a.py 2>/dev/null"), ("echo \"" + pyStr(EMOJI) + "\" | wc -c"), ("echo \"" + pyStr(EMOJI) + "\" > /dev/null"), ("python3 x.py \"" + pyStr(EMOJI) + "\" 2>&1")]) {
this.assertFalse(blocked({"tool_name": "Bash", "tool_input": {"command": command}}), "blocked a read command; write-shape matching is too broad");
}
}
test_clean_bash_writes_pass():any{
this.assertFalse(blocked({"tool_name": "Bash", "tool_input": {"command": "echo \"# [OK]\" > /tmp/a.js"}}));
}
}
class TestTheGuardBlocksDefectiveHwpx extends Case {
payload(path:any,tool:any="Bash"):any{
let inner:any;
if(truth((isDeepStrictEqual(tool,"Bash")))) {
(inner={"command": ("cp " + pyStr(path) + " /tmp/deliver.hwpx")});
} else {
(inner={"file_path": pyStr(path)});
}
return {"tool_name": tool, "tool_input": inner};
}
test_mimetype_not_first_is_blocked():any{
let path:any;
(path=write_hwpx(join(this.dir,"a.hwpx"), {mimetype_first: false}));
this.assertTrue(guard_says_block(this.payload(path)));
}
test_compressed_mimetype_is_blocked():any{
let path:any;

(path=write_hwpx(join(this.dir,"b.hwpx"), {stored: false}));
this.assertTrue(guard_says_block(this.payload(path)));
}
test_wrong_mimetype_is_blocked():any{
let path:any;
(path=write_hwpx(join(this.dir,"c.hwpx"), {mimetype: "application/zip"}));
this.assertTrue(guard_says_block(this.payload(path)));
}
test_missing_required_entry_is_blocked():any{
let path:any;
(path=write_hwpx(join(this.dir,"d.hwpx"), {section: false}));
this.assertTrue(guard_says_block(this.payload(path)));
}
test_leftover_reference_thumbnail_is_blocked():any{
let path:any;
(path=write_hwpx(join(this.dir,"e.hwpx"), {preview: Buffer.alloc(4096,120)}));
this.assertTrue(guard_says_block(this.payload(path)));
}
test_bordered_charpr_is_blocked():any{
let path:any;
(path=write_hwpx(join(this.dir,"f.hwpx"), {header: BORDERED_HEADER}));
this.assertTrue(guard_says_block(this.payload(path)));
}
test_the_reason_names_the_path_and_the_repair():any{
let path:any,reason:any,result:any;
(path=write_hwpx(join(this.dir,"g.hwpx"), {preview: Buffer.alloc(4096,120)}));
(result=run(this.payload(path),GUARD));
(reason=at(JSON.parse(result.stdout), "reason"));
this.assertIn(pyStr(path), reason);
this.assertIn("validate_hwpx.py", reason);
}
test_every_registered_tool_reaches_the_same_judgement():any{
let path:any,tool:any;

(path=write_hwpx(join(this.dir,"h.hwpx"), {section: false}));
for (let tool of ["Bash", "Read", "Write", "Edit"]) {
this.assertTrue(guard_says_block(this.payload(path, tool)));
}
}
}
class TestWhatTheGuardDoesNotBlock extends Case {
test_a_sound_hwpx_passes():any{
let path:any;
(path=write_hwpx(join(this.dir,"ok.hwpx")));
this.assertFalse(guard_says_block({"tool_name": "Bash", "tool_input": {"command": ("cp " + pyStr(path) + " /tmp/")}}), "blocked a valid file; this is deadlock, not a gate");
}
test_a_path_that_does_not_exist_passes():any{
this.assertFalse(guard_says_block({"tool_name": "Bash", "tool_input": {"command": "cp /nowhere/ghost.hwpx /tmp/"}}));
}
test_the_skills_own_tools_pass():any{
let path:any,tool:any;

(path=write_hwpx(join(this.dir,"broken.hwpx"), {section: false}));
for (let tool of ["validate_hwpx.py", "fix_borders.py", "sanitize_template.py"]) {
this.assertFalse(guard_says_block({"tool_name": "Bash", "tool_input": {"command": ("python3 scripts/" + pyStr(tool) + " " + pyStr(path))}}), "blocked a repair command; this is deadlock");
}
}
test_a_file_that_is_not_a_zip_passes():any{
let path:any;

(path=join(this.dir,"notzip.hwpx"));
writeFileSync(path,"this is not an hwpx");
this.assertFalse(guard_says_block({"tool_name": "Read", "tool_input": {"file_path": pyStr(path)}}));
}
test_unrelated_tool_input_passes():any{
this.assertFalse(guard_says_block({"tool_name": "Write", "tool_input": {"file_path": "/tmp/a.md"}}));
}
test_broken_stdin_fails_open():any{
let raw:any,result:any;
for (let raw of ["", "not json", "{\"tool_input\": \"문자열이다\"}"]) {
(result=run({},GUARD,{raw:raw}));
this.assertEqual(result.returncode, 0, "fail-open contract violated");
this.assertEqual(decision(result), null);
}
}
}
class TestTheMeasuredExitCodes extends Case {
cases():any{
let broken:any,sound:any;
(broken=write_hwpx(join(this.dir,"x.hwpx"), {section: false}));
(sound=write_hwpx(join(this.dir,"y.hwpx")));
return [["block_emoji", "block", HOOK, {"tool_name": "Write", "tool_input": {"content": EMOJI}}, "block"], ["block_emoji", "pass", HOOK, {"tool_name": "Write", "tool_input": {"content": "[OK]"}}, null], ["block_emoji", "fail-open", HOOK, {"garbage": true}, null], ["hwpx_guard", "block", GUARD, {"tool_name": "Bash", "tool_input": {"command": ("cp " + pyStr(broken) + " /tmp/")}}, "block"], ["hwpx_guard", "pass", GUARD, {"tool_name": "Bash", "tool_input": {"command": ("cp " + pyStr(sound) + " /tmp/")}}, null], ["hwpx_guard", "fail-open", GUARD, {"tool_input": null}, null]];
}
test_every_path_exits_zero_and_speaks_on_stdout():any{
let hook:any,path_name:any,payload:any,result:any,script:any,want:any;
for (let [hook, path_name, script, payload, want] of this.cases()) {
(result=run(payload,script));
this.assertEqual(result.returncode, 0, "nonzero exit is not this tree's contract");
this.assertEqual(decision(result), want);
}
}
}
class TestItDoesNotViolateItself extends Case {
test_the_hook_emits_no_emoji():any{
let found:any,pattern:any;
(pattern=String("[🌀-🫿☀-➿⬀-⯿️]"));
(found=findall(pattern,readFileSync(HOOK,"utf8")));
this.assertEqual(found, [], "the emoji-blocking hook emits emoji");
}
test_no_registered_hook_emits_emoji():any{
let found:any,pattern:any,script:any;

(pattern=String("[🌀-🫿☀-➿⬀-⯿️]"));
for (let script of [HOOK, GUARD]) {
(found=findall(pattern,readFileSync(script,"utf8")));
this.assertEqual(found, []);
}
}
}
class TestBlockEmojiReallyFailsOpen extends Case {
PATHS:any={"not JSON": "not json{", "null": "null", "array": "[]"};
test_every_broken_stdin_exits_zero_without_blocking():any{
let name:any,raw:any,result:any;
for (let [name, raw] of Object.entries(this.PATHS) as [string,string][]) {
(result=run({},HOOK,{raw:raw}));
this.assertEqual(result.returncode, 0, "fail-open contract violated");
this.assertIsNone(decision(result), "blocked indeterminate input");
}
}
test_the_two_handlers_are_distinguishable():any{
let loud:any,quiet:any;

(quiet=run({},HOOK,{raw:at(this.PATHS, "not JSON")}));
(loud=run({},HOOK,{raw:at(this.PATHS, "null")}));
this.assertEqual(strip(quiet.stderr), "", "JSONDecodeError produced output");
this.assertIn("Hook error", loud.stderr, "other exception disappeared silently");
}
}
test('TestTheHookArrived.test_the_hook_file_is_present',()=>{const c=new TestTheHookArrived();try{c.test_the_hook_file_is_present();}finally{c.close();}});
test('TestTheHookArrived.test_hooks_json_registers_it',()=>{const c=new TestTheHookArrived();try{c.test_hooks_json_registers_it();}finally{c.close();}});
test('TestTheHookArrived.test_the_guard_file_is_present',()=>{const c=new TestTheHookArrived();try{c.test_the_guard_file_is_present();}finally{c.close();}});
test('TestTheHookArrived.test_hooks_json_registers_the_guard',()=>{const c=new TestTheHookArrived();try{c.test_hooks_json_registers_the_guard();}finally{c.close();}});
test('TestTheHookArrived.test_the_contract_declares_the_required_fields',()=>{const c=new TestTheHookArrived();try{c.test_the_contract_declares_the_required_fields();}finally{c.close();}});
test('TestTheHookArrived.test_the_contract_names_every_registered_hook',()=>{const c=new TestTheHookArrived();try{c.test_the_contract_names_every_registered_hook();}finally{c.close();}});
test('TestTheHooksJsonSchema.test_no_fields_the_host_does_not_know',()=>{const c=new TestTheHooksJsonSchema();try{c.test_no_fields_the_host_does_not_know();}finally{c.close();}});
test('TestTheHooksJsonSchema.test_every_registered_command_points_at_a_real_file',()=>{const c=new TestTheHooksJsonSchema();try{c.test_every_registered_command_points_at_a_real_file();}finally{c.close();}});
test('TestTheHooksJsonSchema.test_the_guard_matcher_matches_its_own_declaration',()=>{const c=new TestTheHooksJsonSchema();try{c.test_the_guard_matcher_matches_its_own_declaration();}finally{c.close();}});
test('TestTheChainOrder.test_the_measured_order_is_the_declared_one',()=>{const c=new TestTheChainOrder();try{c.test_the_measured_order_is_the_declared_one();}finally{c.close();}});
test('TestTheChainOrder.test_declared_events_are_exactly_these',()=>{const c=new TestTheChainOrder();try{c.test_declared_events_are_exactly_these();}finally{c.close();}});
test('TestTheChainOrder.test_the_gate_declares_no_event_this_file_lacks',()=>{const c=new TestTheChainOrder();try{c.test_the_gate_declares_no_event_this_file_lacks();}finally{c.close();}});
test('TestTheChainOrder.test_the_order_agrees_with_check_load',()=>{const c=new TestTheChainOrder();try{c.test_the_order_agrees_with_check_load();}finally{c.close();}});
test('TestTheChainOrder.test_the_gate_declares_no_hook_that_is_gone',()=>{const c=new TestTheChainOrder();try{c.test_the_gate_declares_no_hook_that_is_gone();}finally{c.close();}});
test('TestMatcherMatchesTheCode.test_every_tool_in_the_matcher_is_actually_read',()=>{const c=new TestMatcherMatchesTheCode();try{c.test_every_tool_in_the_matcher_is_actually_read();}finally{c.close();}});
test('TestMatcherMatchesTheCode.test_notebook_edit_is_covered',()=>{const c=new TestMatcherMatchesTheCode();try{c.test_notebook_edit_is_covered();}finally{c.close();}});
test('TestTheExitContract.test_blocking_exits_zero_and_speaks_on_stdout',()=>{const c=new TestTheExitContract();try{c.test_blocking_exits_zero_and_speaks_on_stdout();}finally{c.close();}});
test('TestTheExitContract.test_the_reason_names_the_offending_character',()=>{const c=new TestTheExitContract();try{c.test_the_reason_names_the_offending_character();}finally{c.close();}});
test('TestBashWritesAreCovered.test_every_write_shape_is_caught',()=>{const c=new TestBashWritesAreCovered();try{c.test_every_write_shape_is_caught();}finally{c.close();}});
test('TestWhatItDoesNotBlock.test_korean_and_ascii_markers_pass',()=>{const c=new TestWhatItDoesNotBlock();try{c.test_korean_and_ascii_markers_pass();}finally{c.close();}});
test('TestWhatItDoesNotBlock.test_read_only_bash_commands_pass',()=>{const c=new TestWhatItDoesNotBlock();try{c.test_read_only_bash_commands_pass();}finally{c.close();}});
test('TestWhatItDoesNotBlock.test_clean_bash_writes_pass',()=>{const c=new TestWhatItDoesNotBlock();try{c.test_clean_bash_writes_pass();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_mimetype_not_first_is_blocked',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_mimetype_not_first_is_blocked();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_compressed_mimetype_is_blocked',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_compressed_mimetype_is_blocked();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_wrong_mimetype_is_blocked',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_wrong_mimetype_is_blocked();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_missing_required_entry_is_blocked',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_missing_required_entry_is_blocked();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_leftover_reference_thumbnail_is_blocked',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_leftover_reference_thumbnail_is_blocked();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_bordered_charpr_is_blocked',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_bordered_charpr_is_blocked();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_the_reason_names_the_path_and_the_repair',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_the_reason_names_the_path_and_the_repair();}finally{c.close();}});
test('TestTheGuardBlocksDefectiveHwpx.test_every_registered_tool_reaches_the_same_judgement',()=>{const c=new TestTheGuardBlocksDefectiveHwpx();try{c.test_every_registered_tool_reaches_the_same_judgement();}finally{c.close();}});
test('TestWhatTheGuardDoesNotBlock.test_a_sound_hwpx_passes',()=>{const c=new TestWhatTheGuardDoesNotBlock();try{c.test_a_sound_hwpx_passes();}finally{c.close();}});
test('TestWhatTheGuardDoesNotBlock.test_a_path_that_does_not_exist_passes',()=>{const c=new TestWhatTheGuardDoesNotBlock();try{c.test_a_path_that_does_not_exist_passes();}finally{c.close();}});
test('TestWhatTheGuardDoesNotBlock.test_the_skills_own_tools_pass',()=>{const c=new TestWhatTheGuardDoesNotBlock();try{c.test_the_skills_own_tools_pass();}finally{c.close();}});
test('TestWhatTheGuardDoesNotBlock.test_a_file_that_is_not_a_zip_passes',()=>{const c=new TestWhatTheGuardDoesNotBlock();try{c.test_a_file_that_is_not_a_zip_passes();}finally{c.close();}});
test('TestWhatTheGuardDoesNotBlock.test_unrelated_tool_input_passes',()=>{const c=new TestWhatTheGuardDoesNotBlock();try{c.test_unrelated_tool_input_passes();}finally{c.close();}});
test('TestWhatTheGuardDoesNotBlock.test_broken_stdin_fails_open',()=>{const c=new TestWhatTheGuardDoesNotBlock();try{c.test_broken_stdin_fails_open();}finally{c.close();}});
test('TestTheMeasuredExitCodes.test_every_path_exits_zero_and_speaks_on_stdout',()=>{const c=new TestTheMeasuredExitCodes();try{c.test_every_path_exits_zero_and_speaks_on_stdout();}finally{c.close();}});
test('TestItDoesNotViolateItself.test_the_hook_emits_no_emoji',()=>{const c=new TestItDoesNotViolateItself();try{c.test_the_hook_emits_no_emoji();}finally{c.close();}});
test('TestItDoesNotViolateItself.test_no_registered_hook_emits_emoji',()=>{const c=new TestItDoesNotViolateItself();try{c.test_no_registered_hook_emits_emoji();}finally{c.close();}});
test('TestBlockEmojiReallyFailsOpen.test_every_broken_stdin_exits_zero_without_blocking',()=>{const c=new TestBlockEmojiReallyFailsOpen();try{c.test_every_broken_stdin_exits_zero_without_blocking();}finally{c.close();}});
test('TestBlockEmojiReallyFailsOpen.test_the_two_handlers_are_distinguishable',()=>{const c=new TestBlockEmojiReallyFailsOpen();try{c.test_the_two_handlers_are_distinguishable();}finally{c.close();}});
