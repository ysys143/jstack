/** Native owning contracts; original populations and deletion floors remain fixed. */
import {readFileSync,existsSync,statSync,readdirSync,writeFileSync,mkdirSync,cpSync,symlinkSync,rmSync} from 'node:fs';
import {dirname,basename,join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {runProcess} from '../../../../../runtime/os.js';
import {check_no_constant_assertions,check_total,check_skill_body,check_ref_contracts,split_frontmatter,check_body_deletion,check_contract_coverage,check_script_contracts,check_body_paths,read_ref,content_bytes,in_deleted_run,type Result} from '../../../../_suite_lib.js';
import {truth,length,contains,unique,sorted,repr,at,slice,strip,lstrip,rstrip,split,lines,count,starts,ends,lower,joinText,replace,findall,finditer,search,match,group,sub,isdir,isinstance,temporaryDirectory,removeTree,range,isdigit,enumerate} from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SKILLS=dirname(ROOT),HERE=dirname(SUITE_FILE);
const results:Result[]=[],MISSING:string[]=[];
function check(name:string,ok:any,detail=''):void{results.push([name,truth(ok),detail]);console.log(`[${truth(ok)?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
function isfile(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;MISSING.push(relative(ROOT,path).split(sep).join('/'));return '';}}
function regexSplit(pattern:string,text:string):string[]{let flags='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,value)=>{flags=value;return '';});return text.split(new RegExp(pattern,flags));}
function compare(a:any,b:any,op:string):boolean{if(a instanceof Set&&b instanceof Set){const sub=[...a].every(v=>b.has(v)),sup=[...b].every(v=>a.has(v));return op==='<='?sub:op==='>='?sup:op==='<'?sub&&a.size<b.size:sup&&a.size>b.size;}return op==='<='?a<=b:op==='>='?a>=b:op==='<'?a<b:a>b;}

const PLUGIN_ROOT=dirname(dirname(ROOT)),HOOK=join(PLUGIN_ROOT,'hooks/ensure-statusline.mjs'),CMD_DIR=join(PLUGIN_ROOT,'commands');
function escapeRegex(value:string):string{return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function have_node():boolean{return Number(process.versions.node.split('.')[0])>=20;}
function sha(path:string):string{return createHash('sha256').update(readFileSync(path)).digest('hex');}
function manifest_rows():string[][]{return read(join(ROOT,'UPSTREAM.sha256')).split('\n').filter(line=>line.trim()&&!line.startsWith('#')).flatMap(line=>{const row=/^(\S+)\s+(.+)$/.exec(line);return row?[[row[1],row[2].trim()]]:[];});}
function vendored_files():string[]{const out:string[]=[];function walk(path:string){for(const entry of readdirSync(path,{withFileTypes:true})){if(entry.isDirectory()||(entry.isSymbolicLink()&&isdir(join(path,entry.name)))){if(!['node_modules','__pycache__','tests','references'].includes(entry.name))walk(join(path,entry.name));}else out.push(relative(ROOT,join(path,entry.name)).split(sep).join('/'));}}walk(ROOT);return out.sort();}
function run_build_axes(check:(name:string,ok:any,detail?:string)=>void):void{
const before=Object.fromEntries(['index.js','check-usage.js'].map(name=>[name,sha(join(ROOT,'dist',name))]));const work=temporaryDirectory();
try{const dst=join(work,'d');cpSync(ROOT,dst,{recursive:true,filter:path=>!relative(ROOT,path).split(sep).some(name=>['node_modules','__pycache__','tests'].includes(name))});const nm=process.env.JSTACK_DASHBOARD_DEPENDENCIES||join(ROOT,'node_modules');if(isdir(nm))symlinkSync(nm,join(dst,'node_modules'),'dir');for(const name of Object.keys(before))rmSync(join(dst,'dist',name));
const result=runProcess(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{cwd:dst});check('Build: npm run build exits 0',result.status===0,result.status?(result.stderr||result.stdout).trim().split('\n').at(-1)?.slice(0,90):'');
const same=Object.keys(before).filter(name=>isfile(join(dst,'dist',name))&&sha(join(dst,'dist',name))===before[name]);check('Build: outputs are byte-identical to committed dist',same.length===Object.keys(before).length,`Matching ${same.length}/${Object.keys(before).length}`);
}finally{removeTree(work);}}
function run_hook_axes(check:(name:string,ok:any,detail?:string)=>void):void{
const work=temporaryDirectory();try{const cfg=join(work,'cfg'),data=join(cfg,'plugins','data',`${PLUGIN}-${MARKETPLACE}`),home=join(work,'home');mkdirSync(cfg);mkdirSync(data,{recursive:true});mkdirSync(home);const pinned=`node "/x/.claude/plugins/cache/${MARKETPLACE}/${PLUGIN}/0.8.0-staging/${DIST_SUB}/index.js"`,original=JSON.stringify({statusLine:{type:'command',command:pinned}},null,2),sp=join(cfg,'settings.json');writeFileSync(sp,original);
const packageRoot=process.env.JSTACK_PACKAGE_ROOT; if(packageRoot)writeFileSync(join(cfg,'plugins','installed_plugins.json'),JSON.stringify({version:2,plugins:{[`${PLUGIN}@${MARKETPLACE}`]:[{scope:'user',installPath:packageRoot,version:'0.9.7'}]}}));
const run=(on:boolean)=>{const env={...process.env,HOME:home,USERPROFILE:home,CLAUDE_PLUGIN_ROOT:process.env.JSTACK_PACKAGE_ROOT||join(work,'package-root-without-payload'),CLAUDE_PLUGIN_DATA:data,CLAUDE_CONFIG_DIR:cfg};delete(env as NodeJS.ProcessEnv).JSTACK_DASHBOARD_STATUSLINE;if(on)(env as NodeJS.ProcessEnv).JSTACK_DASHBOARD_STATUSLINE='1';return runProcess(process.execPath,[HOOK],{env});};
const off=run(false);check('Hook: default off writes nothing',off.status===0&&read(sp)===original&&readdirSync(data).length===0,`data ${JSON.stringify(readdirSync(data))}`);const on=run(true),now=JSON.parse(read(sp));check('Hook: enabling installs the shim and repoints statusLine',on.status===0&&isfile(join(data,'statusline.mjs'))&&now.statusLine.command!==pinned,now.statusLine.command.slice(0,70));const bak=sp+'.bak';check('Hook: .bak preserves original bytes before modification',isfile(bak)&&read(bak)===original,isfile(bak)?'Content differs':'Absent');
const legacy=`node "/x/.claude/plugins/cache/${MARKETPLACE}/${PLUGIN}/0.8.0-staging/skills/dashboard/dist/index.js"`;writeFileSync(sp,JSON.stringify({statusLine:{type:'command',command:legacy}},null,2));const again=run(true),moved=JSON.parse(read(sp));check('Hook: repoints a command pinned without payload/',again.status===0&&moved.statusLine.command.includes('statusline.mjs'),moved.statusLine.command.slice(0,70));
const cache=join(work,'cache');for(const version of ['0.8.0-staging','0.8.0','junk','0.8.0-']){const path=join(cache,version,DIST_SUB);mkdirSync(path,{recursive:true});writeFileSync(join(path,'index.js'),'');}const script=`import {resolveLatestDist} from ${JSON.stringify(pathToFileURL(join(ROOT,'scripts/statusline-shim.mjs')).href)};console.log(resolveLatestDist(process.argv[1]));`,probe=runProcess(process.execPath,['--input-type=module','-e',script,cache]);check('Hook: accepts prereleases and prefers the stable release of the same version',probe.status===0&&probe.stdout.includes(sep+'0.8.0'+sep),probe.stdout.trim()||probe.stderr.trim().slice(0,90));
}finally{removeTree(work);}}
function run_install_axes(check:(name:string,ok:any,detail?:string)=>void):void{
const pkg=process.env.JSTACK_PACKAGE_ROOT;check('Layout: built package places dist at the shim subpath',!!pkg&&isfile(join(pkg!,DIST_SUB,'index.js'))&&isfile(join(pkg!,'hooks','hooks.json')),pkg?join(DIST_SUB,'index.js'):'JSTACK_PACKAGE_ROOT unset: run through run_suites');
const work=temporaryDirectory();try{const installer=join(ROOT,'scripts/install-statusline.mjs'),home=join(work,'home'),cfg=join(work,'cfg'),empty=join(work,'empty');mkdirSync(join(home,'.claude'),{recursive:true});mkdirSync(empty);
writeFileSync(join(home,'.claude','claude-dashboard.local.json'),JSON.stringify({language:'en',plan:'max',displayMode:'custom',lines:[['model','context','cost']],cache:{ttlSeconds:300}}));
const env={...process.env,HOME:home,USERPROFILE:home};delete(env as NodeJS.ProcessEnv).CLAUDE_CONFIG_DIR;
const install=(dir:string,...extra:string[])=>runProcess(process.execPath,[installer,'install','--config-dir',dir,...extra],{env});
const none=install(empty);check('Install: without an installed build exits 1 and writes nothing',none.status===1&&readdirSync(empty).length===0,`rc=${none.status} ${JSON.stringify(readdirSync(empty))}`);
const dist=join(cfg,'plugins','cache',MARKETPLACE,PLUGIN,'0.8.0-staging',DIST_SUB);mkdirSync(dist,{recursive:true});cpSync(join(ROOT,'dist'),dist,{recursive:true});cpSync(join(ROOT,'package.json'),join(dist,'..','package.json'));
const fresh=install(cfg),sp=join(cfg,'settings.json'),shim=join(cfg,'plugins','data',`${PLUGIN}-${MARKETPLACE}`,'statusline.mjs'),written=isfile(sp)?JSON.parse(read(sp)):{};
check('Install: a config without settings.json gains the shim statusLine',fresh.status===0&&isfile(shim)&&written.statusLine?.command===`node ${JSON.stringify(shim)}`,`rc=${fresh.status} ${(written.statusLine?.command??fresh.stdout).slice(0,70)}`);
const sample=JSON.stringify({model:{display_name:'Opus'},context_window:{context_window_size:200000,current_usage:{input_tokens:50000,cache_creation_input_tokens:0,cache_read_input_tokens:0}},cost:{total_cost_usd:0.5}});
const render=runProcess(process.execPath,[shim],{env:{...env,CLAUDE_CONFIG_DIR:cfg},input:sample});check('Install: the installed shim renders the staging build',render.status===0&&render.stdout.includes('$0.50')&&render.stdout.includes('50K/200K'),render.stdout.replace(/\x1b\[[0-9;]*m/g,'').trim().slice(0,70)||render.stderr.trim().slice(0,70));
writeFileSync(join(dist,'check-usage.js'),'console.log("usage-args:"+process.argv.slice(2).join(","))\n');
const usage=runProcess(process.execPath,[shim,'--check-usage','--json'],{env:{...env,CLAUDE_CONFIG_DIR:cfg}});
check('Install: shim usage mode resolves the same installation without a fixed identity',usage.status===0&&usage.stdout.trim()==='usage-args:--json',usage.stdout.trim()||usage.stderr.trim());
const aliasText=read(join(CMD_DIR,'dashboard-alias.md')),aliasProgram=/```javascript\n([\s\S]*?)\n```/.exec(aliasText)?.[1]??'';
const aliasRun=runProcess(process.execPath,['-e',aliasProgram,'--','--json'],{env:{...env,CLAUDE_CONFIG_DIR:cfg}});
check('Alias: the shipped resolver delegates through the active owned shim',!!aliasProgram&&aliasRun.status===0&&aliasRun.stdout.trim()==='usage-args:--json',aliasRun.stdout.trim()||aliasRun.stderr.trim());
const unreadable=join(work,'home2');mkdirSync(join(unreadable,'.claude'),{recursive:true});writeFileSync(join(unreadable,'.claude','claude-dashboard.local.json'),JSON.stringify({language:'en',plan:'max',displayMode:'custom',lines:[['model','cost','rateLimit5h','rateLimit7d','rateLimit7dFable']],cache:{ttlSeconds:300}}));
const marker=runProcess(process.execPath,[shim],{env:{...env,HOME:unreadable,USERPROFILE:unreadable,CLAUDE_CONFIG_DIR:cfg},input:sample});const plain=marker.stdout.replace(/\x1b\[[0-9;]*m/g,'');check('Install: an unreadable rate limit renders text, not an emoji',marker.status===0&&plain.includes('5h: --')&&!/[\u2600-\u27bf\u{1f000}-\u{1faff}]/u.test(plain),plain.trim().slice(0,70)||marker.stderr.trim().slice(0,70));
const foreign='{\n    "model": "x",\n    "statusLine": {"type": "command", "command": "ccstatusline", "padding": 0}\n}\n';writeFileSync(sp,foreign);
const refused=install(cfg);check("Install: another tool's statusLine exits 3 and stays byte-identical",refused.status===3&&read(sp)===foreign,`rc=${refused.status}`);
const replaced=install(cfg,'--replace'),after=JSON.parse(read(sp)),bak=sp+'.bak';check('Install: --replace keeps other keys and backs up the original bytes',replaced.status===0&&after.statusLine.command===`node ${JSON.stringify(shim)}`&&after.statusLine.padding===0&&after.model==='x'&&isfile(bak)&&read(bak)===foreign,`rc=${replaced.status}`);
}finally{removeTree(work);}}
const CMDS=["check-usage.md", "dashboard-setup.md", "dashboard-alias.md", "dashboard-repair.md"];
const MARKETPLACE="sample-marketplace";
const PLUGIN="sample-plugin";
const DIST_SUB="payload/skills/dashboard/dist";
const SKIPPED_AXES=["Build: npm run build exits 0", "Build: outputs are byte-identical to committed dist", "Hook: default off writes nothing", "Hook: enabling installs the shim and repoints statusLine", "Hook: .bak preserves original bytes before modification", "Hook: repoints a command pinned without payload/", "Layout: built package places dist at the shim subpath", "Install: without an installed build exits 1 and writes nothing", "Install: a config without settings.json gains the shim statusLine", "Install: the installed shim renders the staging build", "Install: shim usage mode resolves the same installation without a fixed identity", "Alias: the shipped resolver delegates through the active owned shim", "Install: another tool's statusLine exits 3 and stays byte-identical", "Install: --replace keeps other keys and backs up the original bytes", "Install: an unreadable rate limit renders text, not an emoji"];
const NOT_IN_MANIFEST={"SKILL.codex.md": "Locally authored Codex native entry selected by packaging", "SKILL.md": "Locally authored decision layer", "NOTICE": "Locally authored provenance record", "UPSTREAM.sha256": "The manifest itself", "scripts/build.js": "Local change: remove upstream manifest synchronization", "scripts/statusline-shim.mjs": "Local change: installation identity resolver", "scripts/install-statusline.mjs": "Locally authored first-installation script", "scripts/widgets/rate-limit.ts": "Local change: text marker instead of the warning emoji", "scripts/widgets/prompt-cache.ts": "Local change: text markers instead of the prompt-cache state emojis", "dist/index.js": "Local change: bundle includes the emoji-free rate-limit and prompt-cache states", "scripts/__tests__/rate-limit.test.ts": "Local change: upstream test follows the text marker", "scripts/__tests__/widgets.test.ts": "Local change: upstream prompt-cache tests follow the text markers", "scripts/__tests__/statusline-shim.test.ts": "Local change: tests the installed package resolver", "scripts/__tests__/ensure-statusline.test.ts": "Local change: tests the jstack payload layout and opt-in hook", "vitest.config.ts": "Local change: excludes tests for omitted standalone upstream command docs"};
const SKILL_FLOOR=2975;
const READING_FLOOR=2532;
const BOUNDARY_FLOOR=1467;
const RECOVERY_FLOOR=7868;
const BODY_MIN=14;
const TOTAL=83;
const PER_FILE={"SKILL.codex.md": 2, "SKILL.md": 14, "NOTICE": 8, "UPSTREAM.sha256": 2, "LICENSE.upstream": 4, "vitest.config.ts": 3, "references/reading.md": 4, "references/boundary.md": 4, "references/recovery.md": 4};
function main():any{
let _:any,a:any,bad:any,body:any,c:any,drift:any,extra:any,f:any,fm:any,frag:any,h:any,hook:any,k:any,label:any,leaked:any,lic:any,listed:any,live_ran:any,local:any,notice:any,ok:any,passed:any,r:any,rows:any,shim:any,stale:any,t:any,vt:any,want:any;
const codex=read(join(ROOT,"SKILL.codex.md"));
check("Codex: native configuration and host boundaries survive delivery", codex.includes("tui.status_line") && codex.includes("$CODEX_HOME/config.toml") && codex.includes("Do not run the Claude statusline installer") && codex.includes("preserve other settings and comments"));
(rows=manifest_rows());
check("Import: manifest is nonempty", (compare(length(rows),90,">=")), (repr(length(rows)) + " rows"));
(bad=Array.from(rows).filter(([h, r]: any) => truth(!truth(isfile(join(ROOT, r))))).map(([h, r]: any) => (r)));
check("Import: every manifest file exists", !truth(bad), ("Absent " + repr(slice(bad, 0, 3))));
(drift=Array.from(rows).filter(([h, r]: any) => truth(((value:any)=>truth(value)?(!isDeepStrictEqual(sha(join(ROOT, r)),h)):value)(isfile(join(ROOT, r))))).map(([h, r]: any) => (r)));
check("Import: manifest hashes match actual bytes", !truth(drift), ("Mismatches: " + repr(length(drift)) + " " + repr(slice(drift, 0, 3))));
(listed=new Set([...new Set(Array.from(rows).map(([_, r]: any) => (r))),...new Set(Object.keys(NOT_IN_MANIFEST))]));
(extra=Array.from(vendored_files()).filter((f: any) => truth(((!contains(listed, f))))).map((f: any) => (f)));
check("Import: no unlisted files (population)", !truth(extra), ("Unlisted " + repr(slice(extra, 0, 5))));
(stale=Object.keys(NOT_IN_MANIFEST).filter((k: any) => truth(!truth(isfile(join(ROOT, k))))).map((k: any) => (k)));
check("Import: all exceptions exist (no stale exclusions)", !truth(stale), (repr(stale)));
(shim=read(join(ROOT, "scripts", "statusline-shim.mjs")));
check("Identity: shim resolves installed plugin metadata", contains(shim,"installed_plugins.json")&&contains(shim,"installPath"));
check("Identity: shim has a bounded cache fallback", contains(shim,"function scanCache(")&&contains(shim,"latestVersionUnder("));
check("Identity: shim searches the packaged dashboard build", contains(shim,"'payload', 'skills', 'dashboard', 'dist', 'index.js'"));
check("Identity: shim no longer uses the upstream cache path", ((!contains(shim, "'claude-dashboard', 'claude-dashboard'"))));
(hook=read(HOOK));
check("Identity: hook PINNED_TAIL accepts an installed identity", contains(hook,"plugins[/\\\\]cache")&&!contains(hook,MARKETPLACE)&&!contains(hook,PLUGIN));
check("Identity: hook PINNED_TAIL points to payload/skills/dashboard/dist", ((contains(hook, "(?:payload[/\\\\])?skills[/\\\\]dashboard[/\\\\]dist"))));
check("Identity: hook no longer uses the upstream cache identity", ((!contains(hook, "claude-dashboard"))));
check("Identity: hook locates the shim inside this skill", ((contains(hook, "'skills', 'dashboard', 'scripts', 'statusline-shim.mjs'"))));
for (let c of CMDS) {
(t=read(join(CMD_DIR, c)));
(leaked=findall("plugins/cache/claude-dashboard|plugins/data/claude-dashboard-", t));
check(("Identity: " + repr(c) + " contains no stale upstream installation path"), !truth(leaked), (repr(slice(leaked, 0, 2))));
}
if(truth(!truth(have_node()))) {
for (let a of SKIPPED_AXES) {
console.log(("[SKIP] " + repr(a) + " — Not run because Node is unavailable"));
}
check("Dependency: Node is available", false, "Node unavailable: thirteen build/hook/install axes unmeasured");
} else {
check("Dependency: Node is available", ((process.execPath !== null)), ((value:any)=>truth(value)?value:"")(process.execPath));
run_build_axes(check);
run_hook_axes(check);
run_install_axes(check);
}
(notice=((value:any)=>truth(value)?value:"")(read_ref(join(ROOT, "NOTICE"))));
for (let frag of ["v1.34.0", "MIT", "UPSTREAM.sha256"]) {
check(("Provenance: NOTICE identifies '" + repr(frag) + "'"), ((contains(notice, frag))));
}
for (let local of ["scripts/build.js", "scripts/statusline-shim.mjs", "ensure-statusline.mjs"]) {
check(("Provenance: NOTICE names local change '" + repr(local) + "'"), ((contains(notice, local))));
}
(lic=((value:any)=>truth(value)?value:"")(read_ref(join(ROOT, "LICENSE.upstream"))));
check("Provenance: full MIT license exists", ((value:any)=>truth(value)?((contains(lic, "WITHOUT WARRANTY OF ANY KIND"))):value)(((contains(lic, "MIT License")))), (repr(length(lic)) + "B"));
check("Provenance: copyright holder is upstream", ((contains(lic, "uppinote"))));
(vt=((value:any)=>truth(value)?value:"")(read_ref(join(ROOT, "vitest.config.ts"))));
check("Import: vitest targets the upstream test population", contains(vt, "scripts/__tests__/**/*.test.ts"), slice(vt, 0, 120));
check("Import: vitest excludes absent standalone docs with an owning-contract explanation", contains(vt,"scripts/__tests__/commands-config-dir.test.ts")&&contains(vt,"owning contract"), slice(vt, 0, 120));
check("Provenance: NOTICE discloses emoji divergence", ((value:any)=>truth(value)?((contains(notice, "block_emoji"))):value)(((contains(notice, "emoji")))));
([fm, body]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
check_body_paths(check, ROOT, body, {fm_of_skill: fm, orphan_skip: {"scripts": "Vendored upstream source: build reproducibility measures import wiring"}});
check_skill_body(check, ROOT, {needles: ["JSTACK_DASHBOARD_STATUSLINE=1", "**Changes can be reverted.**", "When disabled, this skill does nothing.", "They do not mechanically conflict", "Keep them aligned.", "records its name and fails"], floor: SKILL_FLOOR, orphan_skip: {"scripts": "Vendored upstream source: build reproducibility measures import wiring"}});
check_ref_contracts(check, ROOT, [["reading.md", "Display modes, zero-emoji configuration, and widget interpretation remain", ["\"displayMode\": \"custom\"", "The filename remains upstream's", "are not emoji", "/jstack:check-usage --json"], READING_FLOOR], ["boundary.md", "Ownership table and decision rule remain", ["**Authentication expiry belongs to workspace; budget and allowance consumption belong to dashboard.**", "token has two meanings", "bidirectional references can leave one side silently stale when the other changes"], BOUNDARY_FLOOR], ["recovery.md", "Cause types, diagnosis, opt-in settings, watcher, and machine transition remain", ["| `whole-file-restoration` |", "| `ownership-contention` |", "| `identity-mismatch` |", "| `codex-status-line-lost` |", "Never replaced by repair", "always exits 0 so\nthat a session can start", "jstack installs no operating-system service.", "## Moving an existing machine to this version", "instead of restoring the link"], RECOVERY_FLOOR]]);
check_no_constant_assertions(check, SUITE_FILE);
(live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:", "스크립트 계약:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: PER_FILE, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: BODY_MIN, live_ran: live_ran});
check_total(check, results, TOTAL);
(passed=(Array.from(results).filter((result: Result) => result[1]).map(() => 1)).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((isDeepStrictEqual(passed,length(results)))) ? 0 : 1);
}
process.exitCode=main();
