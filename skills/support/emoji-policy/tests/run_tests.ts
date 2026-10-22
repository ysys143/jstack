/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,statSync,readdirSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {runProcess} from '../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,content_bytes,in_deleted_run,type Result} from '../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail:any=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const PLUGIN=dirname(dirname(ROOT));
const SOURCE_HOOKS_DIR=join(PLUGIN, "hosts", "claude", "hooks");
const BUILT_HOOKS_DIR=join(PLUGIN, "hooks");
const HOOKS_DIR=(truth(isdir(SOURCE_HOOKS_DIR)) ? SOURCE_HOOKS_DIR : BUILT_HOOKS_DIR);
const HOOK=join(HOOKS_DIR, "block_emoji.js");
const DISPATCH=join(HOOKS_DIR, "dispatch.js");
const POLICIES=join(HOOKS_DIR, "hook-policies.js");
const HOOKS_JSON=join(HOOKS_DIR, "hooks.json");
const CONTRACT=join(HOOKS_DIR, "CONTRACT.md");
const MARK=chr(9989);
const STUB={"Write": {"content": ("# 완료 " + pyStr(MARK))}, "Edit": {"new_string": ("# 완료 " + pyStr(MARK))}, "MultiEdit": {"edits": [{"new_string": "ok"}, {"new_string": ("# 완료 " + pyStr(MARK))}]}, "NotebookEdit": {"new_source": ("x = 1  # " + pyStr(MARK))}, "Bash": {"command": ("echo \"" + pyStr(MARK) + "\" > /tmp/emoji-suite-probe.txt")}};
const WRITE_SHAPES={"Redirect (> and >>)": [("echo \"" + pyStr(MARK) + "\" > /tmp/a.py"), ("echo \"" + pyStr(MARK) + "\" >> /tmp/a.py")], "heredoc": [("python3 - <<EOF\nprint(\"" + pyStr(MARK) + "\")\nEOF"), ("python3 - <<'EOF'\nprint('" + pyStr(MARK) + "')\nEOF")], "In-place edit (sed -i)": [("sed -i \"\" \"s/x/" + pyStr(MARK) + "/\" /tmp/a.py")], "Branch write (tee)": [("echo \"" + pyStr(MARK) + "\" | tee /tmp/a.py")]};
const READ_ONLY=[("grep \"" + pyStr(MARK) + "\" /tmp/a.py"), ("grep \"" + pyStr(MARK) + "\" /tmp/a.py 2>/dev/null"), ("echo \"" + pyStr(MARK) + "\" | wc -c"), ("echo \"" + pyStr(MARK) + "\" > /dev/null"), ("python3 x.py \"" + pyStr(MARK) + "\" 2>&1")];
const BANDS:[number,number,string][]=[[128512, 128591, "Emoticons"], [127744, 128511, "Misc Symbols and Pictographs"], [128640, 128767, "Transport and Map"], [128768, 128895, "Alchemical"], [128896, 129023, "Geometric Shapes Extended"], [129024, 129279, "Supplemental Arrows-C"], [129280, 129535, "Supplemental Symbols and Pictographs"], [129536, 129647, "Chess"], [129648, 129791, "Symbols and Pictographs Extended-A"], [129318, 129335, "Face gestures"], [9728, 9983, "Misc Symbols"], [9984, 10175, "Dingbats"], [8960, 9215, "Misc Technical"], [11088, 11088, "Star"], [12336, 12336, "Wavy dash"], [12349, 12349, "Part alternation mark"], [12951, 12951, "Circled congratulation"], [12953, 12953, "Circled secret"]];
const FAIL_OPEN=[["not JSON", "not json{"], ["null", "null"], ["array", "[]"]];
const hookModule=await import(pathToFileURL(HOOK).href);
function load_hook(){return hookModule;}
function chr(value:number):string{return String.fromCodePoint(value);}
function ord(value:string):number{return value.codePointAt(0)!;}
function pyStr(value:any):string{return typeof value==='string'?value:repr(value);}
function subprocessRun(argv:string[],options:any={}):any{const {capture_output,text,...native}=options;if(native.timeout!==undefined)native.timeout*=1000;const result=runProcess(argv[0],argv.slice(1),native);return {...result,returncode:result.status};}
function fileHandle(path:string,mode:string){if(mode==='w')writeFileSync(path,'');return{write:(text:string)=>mode==='a'||mode==='w'?appendFileSync(path,text):(()=>{throw Error('File is not writable');})(),read:()=>readFileSync(path,'utf8')};}
function run_hook(payload:any=null,{raw=null}:any={}):any{
let out:any,proc:any,text:any,verdict:any;

(text=(truth(((raw !== null))) ? raw : JSON.stringify(payload)));
(proc=subprocessRun([({executable:process.execPath}).executable, HOOK],{input:text,capture_output:true,text:true,timeout:120}));
(out=strip(proc.stdout));
(verdict=null);
if(truth(out)) {
try {(verdict=(JSON.parse(out)["decision"] ?? null));}catch(error){(verdict="<non-JSON output>");}
}
return [proc.status, verdict, proc.stdout, proc.stderr];
}
function declared_bands(pattern_src:any):any{
let body:any,chars:any,i:any,out:any;

(body=slice(pattern_src, (pattern_src.indexOf("[") + 1), pattern_src.lastIndexOf("]")));
body=body.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi,(_match:string,astral:string,bmp:string)=>String.fromCodePoint(parseInt(astral??bmp,16)));
([chars, out, i]=[Array.from(body), [], 0]);
while(truth((compare(i,length(chars),"<")))){if(truth(((value:any)=>truth(value)?(isDeepStrictEqual(at(chars, (i + 1)),"-")):value)((compare((i + 2),length(chars),"<"))))) {
out.push([ord(at(chars, i)), ord(at(chars, (i + 2)))]);
i+=3;
} else {
out.push([ord(at(chars, i)), ord(at(chars, i))]);
i+=1;
}}
return out;
}
function contract_block(text:any,heading:any):any{
let body:any,key:any,line:any,out:any,seg:any,value:any;

if(truth(((!contains(text, ("\n## " + pyStr(heading) + "\n")))))) {
return {};
}
(seg=at(split(text, ("\n## " + pyStr(heading) + "\n"), 1), 1));
if(truth(((!contains(seg, "```contract"))))) {
return {};
}
(body=at(split(at(split(seg, "```contract", 1), 1), "```", 1), 0));
(out={});
for (let line of lines(body)) {
if(truth(((value:any)=>truth(value)?!truth(starts(line, [" ", "\t"])):value)(((contains(line, ":")))))) {
([key, value]=split(line, ":", 1));
if(truth(strip(key))) {
(out[strip(key)]=strip(value));
}
}
}
return out;
}
function main():any{
let _:any,_blk_out:any,_hi:any,_label:any,_raw:any,_stderr:any,_stdout:any,all_open:any,anchors:any,astral_leak:any,b:any,blk_rc:any,blk_verdict:any,branch_decl:any,branch_live:any,command:any,commands:any,contract:any,cp:any,decl:any,entry:any,exit_decl:any,fell_open:any,fired:any,fm:any,h2:any,hi:any,hook:any,hook_tests:any,hook_tests_src:any,i:any,j:any,l2:any,label:any,leaks:any,live_bands:any,lo:any,matcher_tools:any,missed:any,module:any,n:any,noisy:any,ok:any,open_decl:any,over:any,overblocked:any,owner:any,pass_decl:any,pass_out:any,pass_rc:any,pass_verdict:any,passed:any,payload:any,probes:any,r:any,ranges:any,raw:any,rc:any,registry:any,rows:any,sample:any,shape:any,silent:any,skill:any,state:any,stderr:any,swallowed:any,tool:any,verdict:any,verify_decl:any,verify_hit:any,verify_rel:any,want_bands:any;
(skill=read(join(ROOT, "SKILL.md")));
([fm, _]=split_frontmatter(skill));
check("Identity: the rename is reflected", ((contains(fm, "name: emoji"))), "remove-emoji describes cleanup only; this skill also owns the rules");
check("Language: description has Korean triggers", (compare(length(findall("[가-힣]+", fm)),5,">=")));
check("Language: description has English triggers", ((value:any)=>truth(value)?value:((contains(lower(fm), "strip emoji"))))(((contains(lower(fm), "remove emoji")))));
(ranges=findall("U0001F[0-9A-Fa-f]{3}-|u2300-|u26FF|u27BF", skill));
check("No copies: the body does not duplicate the range table", !truth(ranges), (pyStr(length(ranges)) + " range literals; import the hook's EMOJI_PATTERN"));
check("No copies: explains why duplication is forbidden", ((value:any)=>truth(value)?((contains(lower(skill), "parity"))):value)(((contains(skill, "third copy")))));
check("No copies: provides the import path", ((value:any)=>truth(value)?((contains(skill, "block_emoji.js"))):value)(((contains(skill, "await import")))));
(module=load_hook());
check("Contract: hook exposes EMOJI_PATTERN at module level", ("EMOJI_PATTERN" in module), "if confined to a function, the skill must create its own copy");
check("Contract: hook exposes containsEmoji", (typeof module.containsEmoji === "function" && module.containsEmoji("plain text").length===0));
check("Contract: SKILL.md uses the two documented names", ((value:any)=>truth(value)?((contains(skill, "containsEmoji"))):value)(((contains(skill, "EMOJI_PATTERN")))));
(sample=("done " + pyStr(chr(9989)) + " and " + pyStr(chr(9888)) + " remaining"));
check("Behavior: detection finds emoji", (isDeepStrictEqual(length(module.containsEmoji(sample)),2)), pyStr(module.containsEmoji(sample)));
check("Behavior: removal strips only emoji", (isDeepStrictEqual(strip(replace(sample.replace(module.EMOJI_PATTERN, ""), "  ", " ")),"done and remaining")));
check("Behavior: Korean text is not targeted", (isDeepStrictEqual(module.containsEmoji("한글만 있는 문장 ㄱㄴㄷ 가나다"),[])));
(fired=Object.fromEntries(Array.from(Object.entries(STUB)).map(([tool, payload]: any) => ([tool, run_hook({"tool_name": tool, "tool_input": payload})]))));
for (let tool of sorted(STUB)) {
([rc, verdict, _stdout, _stderr]=at(fired, tool));
check(("Hook runtime: " + pyStr(tool) + " payload returns rc 0 and decision block"), (isDeepStrictEqual([rc, verdict],[0, "block"])), ("rc=" + pyStr(rc) + " decision=" + pyStr(verdict)));
}
([pass_rc, pass_verdict, pass_out, _]=run_hook({"tool_name": "Write", "tool_input": {"content": "# Complete [OK] -> Next step"}}));
check("Hook runtime: emoji-free writes return rc 0 with no output", (isDeepStrictEqual([pass_rc, pass_verdict, pass_out],[0, null, ""])), ("rc=" + pyStr(pass_rc) + " decision=" + pyStr(pass_verdict) + " stdout=" + pyStr(pass_out)));
for (let shape of sorted(WRITE_SHAPES)) {
(leaks=Array.from(at(WRITE_SHAPES, shape)).filter((command: any) => truth((!isDeepStrictEqual(at(run_hook({"tool_name": "Bash", "tool_input": {"command": command}}), 1),"block")))).map((command: any) => (command)));
check(("Write shape: " + pyStr(shape) + " does not let emoji through"), !truth(leaks), ("commands that passed " + pyStr(leaks)));
}
(overblocked=Array.from(READ_ONLY).filter((command: any) => truth((isDeepStrictEqual(at(run_hook({"tool_name": "Bash", "tool_input": {"command": command}}), 1),"block")))).map((command: any) => (command)));
check("Write shape: read-only commands are not blocked", !truth(overblocked), ("false positives " + pyStr(overblocked)));
(live_bands=declared_bands(module.EMOJI_PATTERN.source));
(want_bands=Array.from(BANDS).map(([lo, hi, _]: any) => ([lo, hi])));
check("Ranges: hook range table matches this table (detects deletion and narrowing)", (isDeepStrictEqual(live_bands,want_bands)), ("hook " + pyStr(length(live_bands)) + " / table " + pyStr(length(want_bands)) + " — hook only " + pyStr(Array.from(live_bands).filter((b: any) => truth(((!contains(want_bands, b))))).map((b: any) => (b))) + " table only " + pyStr(Array.from(want_bands).filter((b: any) => truth(((!contains(live_bands, b))))).map((b: any) => (b)))));
for (let [lo, hi, label] of BANDS) {
(probes=sorted(new Set([lo, Math.floor((lo + hi)/2), hi])));
(missed=Array.from(probes).filter((cp: any) => truth(!truth(module.containsEmoji(chr(cp))))).map((cp: any) => (("U+" + pyStr(cp)))));
check(("Ranges: representative code points in U+" + pyStr(lo) + "-" + pyStr(hi) + " (" + pyStr(label) + ") are detected"), !truth(missed), ("missed " + pyStr(missed)));
}
(swallowed=Array.from(enumerate(BANDS)).filter(([i, [lo, hi, _]]: any) => truth((Array.from(enumerate(BANDS)).map(([j, [l2, h2, _]]: any) => (((value:any)=>truth(value)?((value:any)=>truth(value)?(compare(hi,h2,"<=")):value)((compare(l2,lo,"<="))):value)((!isDeepStrictEqual(j,i)))))).some((value:any)=>truth(value)))).map(([i, [lo, hi, _]]: any) => (("U+" + Number(lo).toString(16).toUpperCase() + "-" + Number(hi).toString(16).toUpperCase()))));
check("Ranges: only one declared band is fully swallowed by another", (isDeepStrictEqual(swallowed,["U+1F926-1F937"])), ("swallowed bands " + pyStr(swallowed)));
(astral_leak=Array.from(BANDS).filter(([lo, _hi, _label]: any) => truth(((value:any)=>truth(value)?(!isDeepStrictEqual(at(run_hook({"tool_name": "Write", "tool_input": {"content": ("x " + pyStr(chr(lo)))}}), 1),"block")):value)((compare(lo,65535,">"))))).map(([lo, _hi, _label]: any) => (("U+" + pyStr(lo)))));
check("Ranges: astral representatives are blocked through the hook process", !truth(astral_leak), ("bands that passed " + pyStr(astral_leak)));
(fell_open=Object.fromEntries(Array.from(FAIL_OPEN).map(([label, raw]: any) => ([label, run_hook(undefined,{raw})]))));
for (let [label, _raw] of FAIL_OPEN) {
([rc, verdict, _stdout, stderr]=at(fell_open, label));
check(("fail-open: " + pyStr(label) + " stdin returns rc 0 without blocking"), (isDeepStrictEqual([rc, verdict],[0, null])), ("rc=" + pyStr(rc) + " decision=" + pyStr(verdict) + " stderr=" + pyStr(slice(strip(stderr), 0, 70))));
}
(silent=strip(at(at(fell_open, "not JSON"), 3)));
(noisy=at(at(fell_open, "null"), 3));
check("fail-open: JSONDecodeError is silent; other exceptions report to stderr", ((value:any)=>truth(value)?((contains(noisy, "Hook error"))):value)((isDeepStrictEqual(silent,""))), ("json=" + pyStr(slice(silent, 0, 40)) + " other=" + pyStr(slice(strip(noisy), 0, 40))));
(registry=((JSON.parse(read(HOOKS_JSON))["hooks"] ?? {})["PreToolUse"] ?? []));
let dispatchEntries:any;
(dispatchEntries=registry.filter((entry: any) => (entry.hooks ?? []).some((hook: any) => contains(hook.command ?? '', 'dispatch.js'))));
(matcher_tools=new Set(dispatchEntries.flatMap((entry: any) => split(entry.matcher ?? '', '|'))));
(commands=dispatchEntries.flatMap((entry: any) => (entry.hooks ?? []).map((hook: any) => hook.command ?? '')));
check("Matcher: dispatcher covers every emoji policy branch", Object.keys(STUB).every(tool => matcher_tools.has(tool)), ("declared " + pyStr(sorted(matcher_tools)) + " / branches " + pyStr(sorted(STUB))));
check("Matcher: exactly one registered dispatcher contains the emoji policy", isDeepStrictEqual(length(commands),1) && contains(commands[0], 'hooks/dispatch.js') && contains(commands[0], 'PreToolUse') && isfile(DISPATCH) && isfile(HOOK) && contains(read(POLICIES), "id: 'emoji'") && /import\(["']\.\/block_emoji\.js["']\)/.test(read(POLICIES)), ("registered " + pyStr(commands)));
(contract=read(CONTRACT));
(decl=contract_block(contract, "block_emoji.js"));
check("Contract parity: legacy policy branches are covered by the dispatcher", ((value:any)=>truth(value)?([...new Set(split((decl["matcher"] ?? ""), "|"))].every(tool => matcher_tools.has(tool))):value)(truth(decl)), ("CONTRACT " + pyStr((decl["matcher"] ?? null)) + " / hooks.json " + pyStr(sorted(matcher_tools))));
([blk_rc, blk_verdict, _blk_out, _]=at(fired, "Write"));
(exit_decl=(decl["exit contract"] ?? ""));
check("Contract parity: exit declaration matches the observed blocking path", ((value:any)=>truth(value)?(isDeepStrictEqual(((contains(exit_decl, "block"))),(isDeepStrictEqual(blk_verdict,"block")))):value)((isDeepStrictEqual(((contains(exit_decl, "exit 0"))),(isDeepStrictEqual(blk_rc,0))))), ("declared " + pyStr(exit_decl) + " / observed rc=" + pyStr(blk_rc) + " decision=" + pyStr(blk_verdict)));
(pass_decl=(decl["pass contract"] ?? ""));
check("Contract parity: pass declaration matches the observed pass path", ((value:any)=>truth(value)?(isDeepStrictEqual(((contains(pass_decl, "no stdout"))),(isDeepStrictEqual(pass_out,"")))):value)((isDeepStrictEqual(((contains(pass_decl, "exit 0"))),(isDeepStrictEqual(pass_rc,0))))), ("declared " + pyStr(pass_decl) + " / observed rc=" + pyStr(pass_rc) + " stdout=" + pyStr(pass_out)));
(open_decl=(decl["fail-open"] ?? ""));
(all_open=(Array.from(Object.values(fell_open)).map((r: any) => (((value:any)=>truth(value)?((at(r, 1) === null)):value)((isDeepStrictEqual(at(r, 0),0)))))).every((value:any)=>truth(value)));
check("Contract parity: fail-open declaration matches all three observed paths", (isDeepStrictEqual(starts(open_decl, "yes"),all_open)), ("declared " + pyStr(slice(open_decl, 0, 24)) + " / observed all_pass=" + pyStr(all_open)));
(rows=findall("(?m)^\\|\\s*`(\\w+)`\\s*\\|\\s*.+?\\s*\\|\\s*(Present|Absent)\\s*\\|\\s*$", contract));
(branch_decl=Object.fromEntries(Array.from(rows).map(([tool, state]: any) => ([tool, (isDeepStrictEqual(state,"Present"))]))));
(branch_live=Object.fromEntries(Object.keys(STUB).map((tool: any) => ([tool, (isDeepStrictEqual(at(at(fired, tool), 1),"block"))]))));
check("Contract parity: per-tool branch table matches observed blocking", (isDeepStrictEqual(branch_decl,branch_live)), ("declared " + pyStr(branch_decl) + " / observed " + pyStr(branch_live)));
(hook_tests=join(HOOKS_DIR, "hooks-migration.test.js"));
(hook_tests_src=(truth(isfile(hook_tests)) ? read(hook_tests) : ""));
(anchors=findall("`([^`]+)`", (decl["RED"] ?? "")));
check("Contract parity: RED anchors point to existing tests", ((value:any)=>truth(value)?(Array.from(anchors).map((n: any) => (((contains(hook_tests_src, n)))))).every((value:any)=>truth(value)):value)(truth(anchors)), ("anchors " + pyStr(anchors) + " / test file " + pyStr(isfile(hook_tests))));
(verify_decl=(decl["verify"] ?? ""));
(verify_hit=search("([\\w./-]+\\.js)", verify_decl));
(verify_rel=(truth(verify_hit) ? at(split(group(verify_hit, 1), "jstack/", 1), -(1)) : ""));
check("Contract parity: verification command points to an existing file", ((value:any)=>truth(value)?isfile(join(PLUGIN, verify_rel)):value)(truth(verify_rel)), ("declared " + pyStr(verify_decl)));
check("Tradeoff: names concrete overblocked targets", ((value:any)=>truth(value)?((contains(skill, chr(8984)))):value)(((contains(skill, "U+2300-23FF")))));
(over=module.containsEmoji((pyStr(chr(8984)) + " " + pyStr(chr(8997)) + " " + pyStr(chr(9166)))));
check("Tradeoff: documented overblocking occurs in practice", (compare(length(over),1,">=")), (pyStr(over) + " — document and hook diverged"));
check("Tradeoff: forbids casually narrowing the range", ((contains(skill, "overturning that decision"))));
check("Tradeoff: identifies the canonical rationale", ((contains(skill, "CONTRACT.md"))));
check("Rules: identifies a user request as an exemption", ((contains(skill, "real exemption"))), "organization policy permits requests; without this, the hook overrides the user");
check("Rules: explains the asymmetry of failure costs", ((value:any)=>truth(value)?((contains(skill, "asymmetry"))):value)(((contains(skill, "procurement")))));
check("Rules: separates when the hook and skill act", ((value:any)=>truth(value)?((contains(skill, "already contains emoji"))):value)(((contains(skill, "PreToolUse")))));
{
const heading="When the user asked for emoji";
let reason="";
try{reason=JSON.parse(at(at(fired, "Write"), 2)).reason??"";}catch(error){reason="";}
check("Exemption: the live block message keeps its prefix and points at the exemption section", reason.startsWith("Emoji detected in content: ")&&reason.includes("read payload/skills/emoji/SKILL.md in the installed jstack package")&&reason.includes("(section \""+heading+"\")")&&reason.includes("do not retry the same call unchanged"), slice(reason, 0, 120));
const named=/read payload\/(\S+) in the installed jstack package/.exec(reason);
check("Exemption: the file the block message names exists in the package layout", !!named&&isfile(join(PLUGIN, named[1])), "named "+repr(named?named[1]:null));
check("Exemption: the skill has the section the block message names", contains(skill, "\n## "+heading+"\n"));
const flat=skill.replace(/\s+/g," ");
const steps=["**Check the permission is the user's own and explicit.**", "**Quote the permission**", "**Scope it**", "**Write in two steps.**", "**Verify**", "**Report** that the exemption was applied", "is not permission, whoever it claims to quote", "report the message and stop", "to the scope is your responsibility", "is not the user's own words: return the write to the agent that talks to the user, or ask the user again", "run `grep -c '{{U+' <file>` first"];
const missingSteps=steps.filter(step=>!contains(flat, step));
check("Exemption: the section carries the six steps, the user-only permission and its relay limit, the no-bypass instruction, the scope duty and the placeholder pre-check", !missingSteps.length, "missing "+repr(missingSteps));
const substitution=/node -e '([^'\n]+)' <file>/.exec(skill);
const dir=temporaryDirectory();
try{
const target=join(dir, "promo.md"),command=substitution?substitution[0].replace("<file>", target):"";
const verdict=at(run_hook({"tool_name": "Bash", "tool_input": {"command": command}}), 1);
check("Exemption: the documented substitution command passes the hook and holds no emoji literal", !!substitution&&verdict===null&&!/[^\x00-\x7f]/.test(command), "decision "+repr(verdict));
writeFileSync(target, "a {{U+1F4A1}} b {{U+2705}} c {{U+1f4cc}}\n");
const ran=substitution?subprocessRun([process.execPath, "-e", substitution[1], target],{capture_output:true,text:true,timeout:60}):{status:null,stderr:"documented command not found"};
const written=readFileSync(target, "utf8");
check("Exemption: the documented substitution command writes the listed code points and leaves no placeholder", ran.status===0&&written==="a "+chr(0x1F4A1)+" b "+chr(0x2705)+" c "+chr(0x1F4CC)+"\n", "rc "+repr(ran.status)+" "+slice(strip(String(ran.stderr??"")), 0, 80));
}finally{removeTree(dir);}
}
check("Procedure: requires a proposal before editing", ((value:any)=>truth(value)?((contains(skill, "the choice is the user"))):value)(((contains(skill, "Propose")))));
check("Procedure: states that replacement is not always right", ((contains(skill, "not always right"))));
check("Procedure: leaves vendored files unchanged", ((value:any)=>truth(value)?((contains(skill, "upstream"))):value)(((contains(skill, "vendored")))));
for (let owner of ["proof", "humanize"]) {
check(("Boundary: says to hand off to " + pyStr(owner)), ((contains(skill, ("`" + pyStr(owner) + "`")))));
}
check_no_constant_assertions(check, SUITE_FILE);
check_skill_body(check, ROOT, {needles: ["`block_emoji.js` stops emoji at write time", "The user asking is a real exemption", "The cost of a leak is not symmetric", "Do not copy the ranges into this file", "a third copy is a third thing to forget", "Narrowing the range means overturning that decision", "Korean is never matched", "Removal and replacement are", "Replacement is not always right", "Emoji inside vendored third-party files are not ours to edit"], floor: 3154});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 26});
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 26}, live_ran: results.filter(([name])=>!name.startsWith("자기검사:")&&!name.startsWith("본문 계약:")).length, completeness: true});
check_total(check, results, 89);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
