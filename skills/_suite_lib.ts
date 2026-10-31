/** Shared regression-suite contracts. Compiled for Node 20; no Python runtime.
 * Source migration preserves measured document/script deletion, frozen Git blob
 * binding, ordered survival and named nonexecution. AST checks target TS/JS.
 */
import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync, mkdirSync, mkdtempSync, cpSync, rmSync, realpathSync, chmodSync, copyFileSync, utimesSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { matchingBlockCount } from '../runtime/sequence.js';
export type Check = (name:string, ok:boolean, detail?:string)=>void;
export type Result = [string, boolean, ...unknown[]];
export const RECURSION_GUARD = '_SUITE_BODY_DELETED';
export const SURVIVAL_FLOOR = 0.70;
export const SELF_CHECK_PREFIXES = ['자기검사:', '계약 커버리지:'];
export const DELETED_MARKER = '.suite-body-deleted';
export const _DELETION_SKIPPED = Symbol('deletion-skipped');
const _SKIPPED_NAMES:string[]=[];
const _REACH_RED=new Set<string>();
function lines(text:string):string[]{return text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).filter((_,i,a)=>i<a.length-1||a[i]!=='');}
function unicodeOrder(a:string,b:string):number{const left=[...a],right=[...b];for(let i=0;i<Math.min(left.length,right.length);i++){const delta=left[i].codePointAt(0)!-right[i].codePointAt(0)!;if(delta)return delta;}return left.length-right.length;}
function sorted(values:Iterable<string>):string[]{return [...values].sort(unicodeOrder);}
function repr(value:unknown):string{if(Array.isArray(value))return'['+value.map(repr).join(', ')+']';if(typeof value==='string')return"'"+value.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";if(value===null||value===undefined)return'None';if(typeof value==='boolean')return value?'True':'False';return String(value);}
const presentDir=(path:string)=>{try{return statSync(path).isDirectory();}catch{return false;}};
const presentFile=(path:string)=>{try{return statSync(path).isFile();}catch{return false;}};
const real=(path:string)=>{try{return realpathSync.native(path);}catch{return resolve(path);}};
const posix=(path:string)=>path.split(sep).join('/');
function git(args:string[],cwd:string){return spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true});}
export function split_frontmatter(text:string):[string,string]{const match=/^---\n(.*?)\n---\n(.*)$/s.exec(text);return match?[match[1],match[2]]:['',text];}
export function _in_git_repo(path:string):boolean{const result=git(['rev-parse','--is-inside-work-tree'],presentDir(path)?path:dirname(path)||'.');return result.status===0&&result.stdout.trim()==='true';}
export function in_deleted_run(root=process.cwd()):boolean{return !!process.env[RECURSION_GUARD]&&presentFile(join(root,DELETED_MARKER))&&!_in_git_repo(root);}
export function _reach_collect(stdout:string):void{if(!process.env.JSTACK_REACH_OUT)return;for(const match of stdout.matchAll(/^\[FAIL\] (.+)$/gm))_REACH_RED.add(match[1]);}
export function reach_dump(liveNames:Iterable<string>):void{const out=process.env.JSTACK_REACH_OUT;if(!out)return;const live=sorted(liveNames),reached=live.filter(name=>[..._REACH_RED].some(line=>line===name||line.startsWith(name+' — ')));try{mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({live,reached}));}catch{}}
export function skipped_names():string[]{return [..._SKIPPED_NAMES];}
export function deletion_skipped():boolean{return process.env.JSTACK_SKIP_DELETION==='1';}
/** A deletion copy reruns a whole suite; without a limit a slow machine shows up only as a silent job timeout. */
const DELETION_RUN_TIMEOUT_MS=600000;
/** Not 0, 1 or 2: a suite that ends this way measured nothing, so floors must not be compared. */
export const UNMEASURED_EXIT=3;
/** A step stopped by its time limit says how busy the machine was, not whether a contract holds. */
export function exit_if_timed_out(result:{error?:Error},step:string):void{
    if((result.error as NodeJS.ErrnoException|undefined)?.code!=='ETIMEDOUT')return;
    process.stderr.write(`[unmeasured] ${step} hit its time limit; this suite measured nothing\n`);process.exit(UNMEASURED_EXIT);
}
export function _skip_named(...names:string[]):void{for(const name of names){_SKIPPED_NAMES.push(name);console.log(`[SKIP] ${name} — deletion regression skipped (measured in the control)`);}}
export interface DeletionOptions {extra_strip?:string[];only?:string|null;runner?:string[]|null;extra_skip?:string[];}
export interface DeletionResult {fails:number;ran:number;rc:number;crashed:boolean;stderr:string;stdout:string;}
function hasSymlinkComponent(root:string,rel:string):boolean{
    if(!safeDeletionRel(rel))return true;try{if(lstatSync(root).isSymbolicLink())return true;}catch{return true;}
    let path=root;const segments=rel.split(/[\\/]+/);
    for(let index=0;index<segments.length;index++){
        path=join(path,segments[index]);let stat;try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;return true;}
        if(stat.isSymbolicLink())return true;if(index<segments.length-1&&!stat.isDirectory())return true;
    }
    return false;
}
function safeDeletionTarget(base:string,rel:string,boundary:string):string|undefined{
    if(!rel||isAbsolute(rel))return undefined;const path=resolve(base,rel);if(!isWithin(boundary,path))return undefined;
    const boundaryRel=relative(resolve(boundary),path);if(!safeDeletionRel(boundaryRel)||hasSymlinkComponent(boundary,boundaryRel))return undefined;return path;
}
export function _strip_one(dst:string,rel:string,boundary=dst):boolean{const path=safeDeletionTarget(dst,rel,boundary);if(!path)return false;let stat;try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}if(!stat.isFile())return false;if(basename(rel)==='SKILL.md'){const [fm]=split_frontmatter(readFileSync(path,'utf8'));writeFileSync(path,fm?`---\n${fm}\n---\n`:'');}else writeFileSync(path,'');return true;}
function writeDeletionMarker(dst:string):void{if(hasSymlinkComponent(dst,DELETED_MARKER))throw Error(`Refusing to write deletion marker through a symbolic link: ${join(dst,DELETED_MARKER)}`);writeFileSync(join(dst,DELETED_MARKER),_DELETION_MARKER_TEXT);}
type DeletionCopyEntry={path:string;kind:'directory'|'file';mode:number;size:number;digest?:string};
type DeletionInventory={fingerprint:string;entries:DeletionCopyEntry[];eligible:boolean;reason?:string};
type DeletionSnapshotEntry={kind:string;mode:number;size:string;dev:string;ino:string;mtimeNs:string;ctimeNs:string;digest?:string;link?:string};
type DeletionSnapshot=Map<string,DeletionSnapshotEntry>;
type RawDeletionResult={stdout:string;stderr:string;rc:number;spawnError:boolean;signal:boolean;crashed:boolean};
type DeletionWorkspace={sourceKey:string;fingerprint:string;work:string;basePlugin:string;scratchPlugin:string;baseSkill:string;scratchSkill:string;inventory:DeletionInventory;baseMetadata:DeletionSnapshot};
type DeletionTiming={logicalOrdinal:number;sourceFingerprint:string|null;conditionFingerprint:string|null;eligible:boolean;cacheEnabled:boolean;workspaceReused:boolean;cacheHit:boolean;physicalExecution:boolean;contaminated:boolean;rc:number|null;crashed:boolean|null;fingerprintMs:number;copyMs:number;copyVerifyMs:number;resetMs:number;resetVerifyMs:number;runMs:number;cleanupMs:number;totalMs:number;fallbackReason?:string};
const _DELETION_WORKSPACES=new Map<string,DeletionWorkspace>();
const _DELETION_RESULT_CACHE=new Map<string,{raw:RawDeletionResult;bytes:number}>();
const _DELETION_TIMINGS=new Map<string,DeletionTiming[]>();
let _DELETION_CACHE_BYTES=0,_DELETION_LOGICAL_COUNT=0,_DELETION_PHYSICAL_COUNT=0,_DELETION_CACHE_HITS=0,_DELETION_EXIT_HOOK_INSTALLED=false,_DELETION_EXIT_CLEANED=false;
const _DELETION_CACHE_LIMIT=32*1024*1024,_DELETION_CACHE_ENTRY_LIMIT=8*1024*1024;
const _DELETION_MARKER_TEXT='This directory is a copy created by body_deletion_regression.\n';
const _DELETION_STARTED_AT=new Date().toISOString();
function tick():number{return Number(process.hrtime.bigint())/1e6;}
function sha256(text:string|Buffer):string{return createHash('sha256').update(text).digest('hex');}
function hashPart(hash:ReturnType<typeof createHash>,value:string):void{hash.update(String(Buffer.byteLength(value,'utf8'))+':');hash.update(value);hash.update('\n');}
function copySkips(skillRoot:string):Set<string>{const skips=new Set(['__pycache__','.omc','results','.git','node_modules',basename(real(tmpdir()))]);if(!['science','author','diagram','journey-qa','dag-it','statechart','create-formal-verification-skill','maintain-formal-verification-skill'].includes(basename(skillRoot)))skips.add('repos');return skips;}
function shouldCopy(source:string,root:string,skips:Set<string>):boolean{return source===root||(!skips.has(basename(source))&&!source.endsWith('.pyc'));}
function deletionInventory(root:string,skillRoot:string):DeletionInventory{
    const start=lstatSync(root);if(!start.isDirectory())return{fingerprint:'',entries:[],eligible:false,reason:'copy root is not a real directory'};
    const skips=copySkips(skillRoot),entries:DeletionCopyEntry[]=[],hash=createHash('sha256');let reason:string|undefined;
    const visit=(path:string,rel:string):void=>{
        const stat=lstatSync(path),mode=stat.mode&0o7777;
        if(stat.isDirectory()){
            entries.push({path:rel,kind:'directory',mode,size:0});hashPart(hash,JSON.stringify([rel,'directory',mode]));
            for(const name of readdirSync(path).sort(unicodeOrder)){const child=join(path,name);if(shouldCopy(child,root,skips))visit(child,rel?posix(join(rel,name)):posix(name));}
        }else if(stat.isFile()){
            const contents=readFileSync(path),digest=sha256(contents);entries.push({path:rel,kind:'file',mode,size:contents.byteLength,digest});hashPart(hash,JSON.stringify([rel,'file',mode,contents.byteLength,digest]));
        }else reason=stat.isSymbolicLink()?'copy tree contains a symbolic link':'copy tree contains a special file';
    };
    visit(root,'');return reason?{fingerprint:'',entries:[],eligible:false,reason}:{fingerprint:hash.digest('hex'),entries,eligible:true};
}
function copyPlugin(source:string,destination:string,skillRoot:string):void{
    mkdirSync(dirname(destination),{recursive:true});const skips=copySkips(skillRoot);
    cpSync(source,destination,{recursive:true,filter:path=>shouldCopy(path,source,skips)});
}
function isWithin(root:string,path:string,allowSame=false):boolean{const rel=relative(resolve(root),resolve(path));return(allowSame&&rel==='')||(rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel));}
function safeDeletionRel(rel:string):boolean{return !!rel&&rel!=='.'&&!isAbsolute(rel)&&!rel.split(/[\\/]+/).includes('..');}
function deletionTargets(options:DeletionOptions):string[]{return options.only!=null?[options.only]:['SKILL.md',...(options.extra_strip??[])];}
function snapshotTree(root:string,includeContent:boolean):DeletionSnapshot{
    const output:DeletionSnapshot=new Map();
    const visit=(path:string,rel:string):void=>{
        const stat=lstatSync(path,{bigint:true}),mode=Number(stat.mode&0o7777n);
        if(stat.isDirectory()){
            output.set(rel,{kind:'directory',mode,size:stat.size.toString(),dev:stat.dev.toString(),ino:stat.ino.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()});
            for(const name of readdirSync(path).sort(unicodeOrder)){const child=join(path,name);visit(child,rel?posix(join(rel,name)):posix(name));}
        }else if(stat.isFile()){
            output.set(rel,{kind:'file',mode,size:stat.size.toString(),dev:stat.dev.toString(),ino:stat.ino.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString(),...(includeContent?{digest:sha256(readFileSync(path))}:{})});
        }else if(stat.isSymbolicLink())output.set(rel,{kind:'symlink',mode,size:stat.size.toString(),dev:stat.dev.toString(),ino:stat.ino.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString(),link:readlinkSync(path)});
        else output.set(rel,{kind:'special',mode,size:stat.size.toString(),dev:stat.dev.toString(),ino:stat.ino.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()});
    };
    visit(root,'');return output;
}
function sameSnapshotState(a:DeletionSnapshotEntry,b:DeletionSnapshotEntry):boolean{return a.kind===b.kind&&a.mode===b.mode&&a.size===b.size&&a.dev===b.dev&&a.ino===b.ino&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.link===b.link;}
function snapshotsMatch(a:DeletionSnapshot,b:DeletionSnapshot):boolean{if(a.size!==b.size)return false;for(const[path,left]of a){const right=b.get(path);if(!right||!sameSnapshotState(left,right))return false;}return true;}
function makeBaseReadonly(root:string,entries:DeletionCopyEntry[]):void{
    for(const entry of [...entries].filter(row=>row.kind==='file'))try{chmodSync(join(root,entry.path),entry.mode&0o555||0o444);}catch{}
    for(const entry of [...entries].filter(row=>row.kind==='directory').sort((a,b)=>b.path.length-a.path.length))try{chmodSync(join(root,entry.path),entry.mode&0o555||0o555);}catch{}
}
function restoreScratchModes(root:string,entries:DeletionCopyEntry[]):void{
    for(const entry of entries.filter(row=>row.kind==='file'))try{chmodSync(join(root,entry.path),entry.mode);}catch{}
    for(const entry of [...entries].filter(row=>row.kind==='directory').sort((a,b)=>b.path.length-a.path.length))try{chmodSync(join(root,entry.path),entry.mode);}catch{}
}
function makeTreeRemovable(root:string):void{
    let stat;try{stat=lstatSync(root);}catch{return;}
    if(stat.isSymbolicLink())return;if(stat.isDirectory()){try{chmodSync(root,0o755);}catch{}for(const name of readdirSync(root))makeTreeRemovable(join(root,name));}
}
function removeDeletionTree(root:string):void{makeTreeRemovable(root);rmSync(root,{recursive:true,force:true});}
function createWorkspace(sourceKey:string,pluginRoot:string,skillRoot:string,inventory:DeletionInventory):{workspace:DeletionWorkspace;copyMs:number;verifyMs:number;resetMs:number}{
    const work=mkdtempSync(join(tmpdir(),'jstack-suite-deletion-opt-')),basePlugin=join(work,'base',basename(pluginRoot)),scratchPlugin=join(work,'scratch',basename(pluginRoot));let copyMs=0,verifyMs=0;
    try{
        const cpStarted=tick();copyPlugin(pluginRoot,basePlugin,skillRoot);copyMs+=tick()-cpStarted;
        const verifyStarted=tick(),copied=deletionInventory(basePlugin,join(basePlugin,relative(pluginRoot,skillRoot)));verifyMs+=tick()-verifyStarted;
        if(!copied.eligible||copied.fingerprint!==inventory.fingerprint)throw Error('source changed while the immutable base was copied');
        makeBaseReadonly(basePlugin,inventory.entries);
        const cloneStarted=tick();copyPlugin(basePlugin,scratchPlugin,join(basePlugin,relative(pluginRoot,skillRoot)));copyMs+=tick()-cloneStarted;
        const resetStarted=tick();restoreScratchModes(scratchPlugin,inventory.entries);const resetMs=tick()-resetStarted;
        const relSkill=relative(pluginRoot,skillRoot),baseSkill=join(basePlugin,relSkill),scratchSkill=join(scratchPlugin,relSkill);
        const workspace:DeletionWorkspace={sourceKey,fingerprint:inventory.fingerprint,work,basePlugin,scratchPlugin,baseSkill,scratchSkill,inventory,baseMetadata:snapshotTree(basePlugin,false)};
        return{workspace,copyMs,verifyMs,resetMs};
    }catch(error){removeDeletionTree(work);throw error;}
}
function discardWorkspace(workspace:DeletionWorkspace):void{removeDeletionTree(workspace.work);if(_DELETION_WORKSPACES.get(workspace.sourceKey)===workspace)_DELETION_WORKSPACES.delete(workspace.sourceKey);}
function restoreWorkspacePaths(workspace:DeletionWorkspace,paths:Iterable<string>):void{
    const entries=new Map(workspace.inventory.entries.map(entry=>[entry.path,entry]));
    for(const rel of new Set(paths)){
        const destination=join(workspace.scratchPlugin,rel),source=join(workspace.basePlugin,rel),entry=entries.get(rel);
        if(entry?.kind==='file'){
            mkdirSync(dirname(destination),{recursive:true});if(existsSync(destination))rmSync(destination,{recursive:true,force:true});copyFileSync(source,destination);
            try{chmodSync(destination,entry.mode);}catch{}
            try{const stat=statSync(source);utimesSync(destination,stat.atime,stat.mtime);}catch{}
        }else if(existsSync(destination))rmSync(destination,{recursive:true,force:true});
    }
}
function expectedWorkspaceDigests(workspace:DeletionWorkspace,changed:Set<string>,markerRel:string):Map<string,string>{
    const expected=new Map(workspace.inventory.entries.filter(entry=>entry.kind==='file').map(entry=>[entry.path,entry.digest!]));
    for(const rel of changed){const path=join(workspace.scratchPlugin,rel);if(presentFile(path))expected.set(rel,sha256(readFileSync(path)));}
    expected.set(markerRel,sha256(_DELETION_MARKER_TEXT));return expected;
}
function auditWorkspace(workspace:DeletionWorkspace,before:DeletionSnapshot,after:DeletionSnapshot,expectedDigests:Map<string,string>):boolean{
    if(!snapshotsMatch(before,after))return false;
    const markerRel=posix(relative(workspace.scratchPlugin,join(workspace.scratchSkill,DELETED_MARKER))),expectedKinds=new Map(workspace.inventory.entries.map(entry=>[entry.path,entry.kind]));expectedKinds.set(markerRel,'file');const expectedPaths=new Set(expectedKinds.keys());
    if(after.size!==expectedPaths.size)return false;for(const path of expectedPaths)if(!after.has(path))return false;
    for(const[path,entry]of after){if(entry.kind!==expectedKinds.get(path))return false;if(entry.kind==='file'&&entry.digest!==expectedDigests.get(path))return false;}
    return true;
}
function cacheable(raw:RawDeletionResult):boolean{return !raw.spawnError&&!raw.signal&&[0,1].includes(raw.rc)&&!raw.crashed;}
function cacheRaw(key:string,raw:RawDeletionResult):void{
    const bytes=Buffer.byteLength(raw.stdout)+Buffer.byteLength(raw.stderr);if(bytes>_DELETION_CACHE_ENTRY_LIMIT)return;
    while(_DELETION_CACHE_BYTES+bytes>_DELETION_CACHE_LIMIT){const first=_DELETION_RESULT_CACHE.entries().next().value as [string,{raw:RawDeletionResult;bytes:number}]|undefined;if(!first)break;_DELETION_RESULT_CACHE.delete(first[0]);_DELETION_CACHE_BYTES-=first[1].bytes;}
    _DELETION_RESULT_CACHE.set(key,{raw,bytes});_DELETION_CACHE_BYTES+=bytes;
}
function materializeDeletion(raw:RawDeletionResult,options:DeletionOptions):DeletionResult{
    const excluded=[...SELF_CHECK_PREFIXES,...options.extra_skip??[]],ran=[...raw.stdout.matchAll(/^\[(?:PASS|FAIL)\] (.+)$/gm)].filter(match=>!excluded.some(prefix=>match[1].startsWith(prefix))).length;
    _reach_collect(raw.stdout);return{fails:[...raw.stdout.matchAll(/^\[FAIL\]/gm)].length,ran,rc:raw.rc,crashed:raw.crashed,stderr:[...raw.stderr].slice(-600).join(''),stdout:raw.stdout};
}
function timingDirectory():string|undefined{
    const candidate=process.env.JSTACK_DELETION_TIMING_DIR??(process.env.JSTACK_SUITE_EVIDENCE_DIR?join(process.env.JSTACK_SUITE_EVIDENCE_DIR,'deletions'):undefined);if(!candidate)return undefined;
    const suiteTmp=process.env.TMPDIR??process.env.TMP??process.env.TEMP;if(suiteTmp&&isWithin(resolve(suiteTmp),resolve(candidate),true))return undefined;
    return resolve(candidate);
}
function recordDeletionTiming(row:DeletionTiming):void{
    const dir=timingDirectory();if(!dir)return;const rows=_DELETION_TIMINGS.get(dir)??[];rows.push(row);_DELETION_TIMINGS.set(dir,rows);
}
function suiteRunMetadata():Record<string,unknown>{
    const output:Record<string,unknown>={};if(process.env.JSTACK_SUITE_RUN_ID)output.runId=process.env.JSTACK_SUITE_RUN_ID;if(process.env.JSTACK_SUITE_INPUT_FINGERPRINT)output.inputFingerprint=process.env.JSTACK_SUITE_INPUT_FINGERPRINT;
    if(process.env.JSTACK_SUITE_ENVIRONMENT){try{output.environment=JSON.parse(process.env.JSTACK_SUITE_ENVIRONMENT);}catch{output.environmentRaw=process.env.JSTACK_SUITE_ENVIRONMENT;}}return output;
}
function deletionExitCleanup():void{
    if(_DELETION_EXIT_CLEANED)return;_DELETION_EXIT_CLEANED=true;const cleanupStarted=tick();for(const workspace of _DELETION_WORKSPACES.values())try{removeDeletionTree(workspace.work);}catch{}const processCleanupMs=tick()-cleanupStarted;_DELETION_WORKSPACES.clear();
    for(const[dir,measurements]of _DELETION_TIMINGS){try{mkdirSync(dir,{recursive:true});const file=join(dir,`deletion-${process.pid}-${randomUUID()}.json`);writeFileSync(file,JSON.stringify({schemaVersion:1,...suiteRunMetadata(),pid:process.pid,nodeVersion:process.version,platform:process.platform,architecture:process.arch,startedAt:_DELETION_STARTED_AT,logicalMeasurementCount:measurements.length,physicalExecutionCount:measurements.filter(row=>row.physicalExecution).length,cacheHitCount:measurements.filter(row=>row.cacheHit).length,processPhysicalExecutionCount:_DELETION_PHYSICAL_COUNT,processCacheHitCount:_DELETION_CACHE_HITS,processCleanupMs,measurements},null,2)+'\n');}catch{}}
}
function installDeletionExitCleanup():void{if(!_DELETION_EXIT_HOOK_INSTALLED){_DELETION_EXIT_HOOK_INSTALLED=true;process.once('exit',deletionExitCleanup);}}
function executionEnvironment():NodeJS.ProcessEnv{return{...process.env,[RECURSION_GUARD]:'1',PYTHONDONTWRITEBYTECODE:'1'};}
function rawSpawn(command:string[],cwd:string,env:NodeJS.ProcessEnv):RawDeletionResult{
    const limit=Number(process.env.JSTACK_DELETION_TIMEOUT_MS)||DELETION_RUN_TIMEOUT_MS;
    const result=spawnSync(command[0],command.slice(1),{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:limit,killSignal:'SIGKILL'});const stdout=result.stdout??'',stderr=result.signal?`deletion run stopped by ${result.signal} after the ${limit} ms limit; nothing was measured\n`:result.stderr??result.error?.message??'';
    return{stdout,stderr,rc:result.status??-1,spawnError:!!result.error,signal:result.signal!==null,crashed:!!result.error||/Traceback \(most recent call last\)|\n\s+at .+\(.+:\d+:\d+\)|\n(?:Error|TypeError|ReferenceError|SyntaxError):/.test(stderr)};
}
function ordinaryDeletionRun(suiteFile:string,skillRoot:string,options:DeletionOptions,metrics:DeletionTiming):DeletionResult{
    const work=mkdtempSync(join(tmpdir(),'jstack-suite-deletion-')),cleanup=()=>{const started=tick();rmSync(work,{recursive:true,force:true});metrics.cleanupMs+=tick()-started;};
    try{
        const pluginRoot=presentDir(join(skillRoot,'skills'))?skillRoot:dirname(dirname(skillRoot)),within=relative(real(pluginRoot),real(work));
        if(within===''||(!within.startsWith('..'+sep)&&within!=='..'&&!isAbsolute(within)))throw Error(`Copy target is inside source; copying would recurse: ${pluginRoot} ⊃ ${work}`);
        const dstPlugin=join(work,basename(pluginRoot)),copyStarted=tick();copyPlugin(pluginRoot,dstPlugin,skillRoot);metrics.copyMs+=tick()-copyStarted;
        const dst=join(dstPlugin,relative(pluginRoot,skillRoot)),resetStarted=tick();if(options.only!=null)_strip_one(dst,options.only,dstPlugin);else{_strip_one(dst,'SKILL.md',dstPlugin);for(const rel of options.extra_strip??[])_strip_one(dst,rel,dstPlugin);}
        writeDeletionMarker(dst);metrics.resetMs+=tick()-resetStarted;
        const command=[...(options.runner??[process.execPath]),join(dst,relative(skillRoot,suiteFile))];metrics.physicalExecution=true;_DELETION_PHYSICAL_COUNT++;const runStarted=tick(),raw=rawSpawn(command,dst,executionEnvironment());metrics.runMs+=tick()-runStarted;metrics.rc=raw.rc;metrics.crashed=raw.crashed;
        return materializeDeletion(raw,options);
    }finally{cleanup();}
}
function optimizedDeletionRun(suiteFile:string,skillRoot:string,options:DeletionOptions,metrics:DeletionTiming):DeletionResult{
    // Reuse supports synchronous suite runners that wait for their own child processes; use JSTACK_DELETION_OPTIMIZE=0 for runners that leave background writers.
    const pluginRoot=presentDir(join(skillRoot,'skills'))?skillRoot:dirname(dirname(skillRoot));
    if(isWithin(real(pluginRoot),real(tmpdir()),true)){metrics.fallbackReason='temporary directory is inside the source tree';return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}
    const inventoryStarted=tick();let inventory:DeletionInventory;
    try{inventory=deletionInventory(pluginRoot,skillRoot);}catch(error){metrics.fingerprintMs+=tick()-inventoryStarted;metrics.fallbackReason=`input fingerprint failed: ${error instanceof Error?error.message:String(error)}`;return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}
    metrics.fingerprintMs+=tick()-inventoryStarted;if(!inventory.eligible){metrics.fallbackReason=inventory.reason??'copy tree is ineligible';return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}
    metrics.eligible=true;metrics.sourceFingerprint=inventory.fingerprint;
    const skillRel=relative(pluginRoot,skillRoot),suiteRel=relative(skillRoot,suiteFile),targets=deletionTargets(options),markerRel=posix(relative(pluginRoot,join(skillRoot,DELETED_MARKER)));
    if(!isWithin(pluginRoot,skillRoot,true)||!isWithin(skillRoot,suiteFile)||!presentDir(skillRoot)||!presentFile(suiteFile)||targets.some(rel=>!safeDeletionTarget(skillRoot,rel,pluginRoot))){metrics.eligible=false;metrics.fallbackReason='suite or mutation path is outside the copied plugin';return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}
    for(const rel of [...targets,DELETED_MARKER]){const path=safeDeletionTarget(skillRoot,rel,pluginRoot);if(!path){metrics.eligible=false;metrics.fallbackReason='a deletion target escapes the copied plugin or crosses a symbolic link';return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}if(existsSync(path)&&!lstatSync(path).isFile()){metrics.eligible=false;metrics.fallbackReason='a deletion target or marker is not a regular file';return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}}
    const normalizedTargets=[...new Set(targets.map(rel=>posix(relative(pluginRoot,resolve(skillRoot,rel)))))];
    const sourceKey=real(pluginRoot)+'\0'+posix(skillRel);let workspace=_DELETION_WORKSPACES.get(sourceKey);
    if(workspace&&workspace.fingerprint!==inventory.fingerprint){const cleanup=tick();discardWorkspace(workspace);metrics.cleanupMs+=tick()-cleanup;workspace=undefined;}
    if(!workspace){
        try{const made=createWorkspace(sourceKey,pluginRoot,skillRoot,inventory);workspace=made.workspace;metrics.copyMs+=made.copyMs;metrics.copyVerifyMs+=made.verifyMs;metrics.resetMs+=made.resetMs;_DELETION_WORKSPACES.set(sourceKey,workspace);}
        catch(error){metrics.eligible=false;metrics.fallbackReason=`workspace preparation failed: ${error instanceof Error?error.message:String(error)}`;return ordinaryDeletionRun(suiteFile,skillRoot,options,metrics);}
    }else metrics.workspaceReused=true;
    const runner=[...(options.runner??[process.execPath])],env=executionEnvironment(),canonicalEnv=Object.keys(env).sort(unicodeOrder).map(key=>[key,env[key]]),command=[...runner,join(workspace.scratchSkill,suiteRel)];
    const condition={input:inventory.fingerprint,root:real(pluginRoot),skill:posix(skillRel),suite:posix(suiteRel),cwd:workspace.scratchSkill,command,mutationTargets:normalizedTargets,environment:canonicalEnv,runtime:{execPath:process.execPath,version:process.version,platform:process.platform,architecture:process.arch},copyPolicy:{skillName:basename(skillRoot),tempName:basename(real(tmpdir()))}};
    const conditionFingerprint=sha256(JSON.stringify(condition));metrics.conditionFingerprint=conditionFingerprint;const cached=metrics.cacheEnabled?_DELETION_RESULT_CACHE.get(conditionFingerprint):undefined;
    if(cached){metrics.cacheHit=true;metrics.physicalExecution=false;_DELETION_CACHE_HITS++;const result=materializeDeletion(cached.raw,options);metrics.rc=result.rc;metrics.crashed=result.crashed;return result;}
    const resetStarted=tick(),changed=new Set<string>();let expectedDigests:Map<string,string>,before:DeletionSnapshot;
    try{
        for(const rel of targets){const copiedRel=posix(relative(pluginRoot,resolve(skillRoot,rel))),didChange=_strip_one(workspace.scratchSkill,rel,workspace.scratchPlugin);if(didChange)changed.add(copiedRel);}
        writeDeletionMarker(workspace.scratchSkill);changed.add(markerRel);
        expectedDigests=expectedWorkspaceDigests(workspace,changed,markerRel);before=snapshotTree(workspace.scratchPlugin,false);
    }catch(error){const cleanup=tick();discardWorkspace(workspace);metrics.cleanupMs+=tick()-cleanup;metrics.fallbackReason=`workspace reset failed: ${error instanceof Error?error.message:String(error)}`;throw error;}
    metrics.resetMs+=tick()-resetStarted;
    metrics.physicalExecution=true;_DELETION_PHYSICAL_COUNT++;const runStarted=tick();let raw:RawDeletionResult;
    try{raw=rawSpawn(command,workspace.scratchSkill,env);}catch(error){raw={stdout:'',stderr:error instanceof Error?error.message:String(error),rc:-1,spawnError:true,signal:false,crashed:true};}
    metrics.runMs+=tick()-runStarted;metrics.rc=raw.rc;metrics.crashed=raw.crashed;
    const verifyStarted=tick();let clean=false;
    try{const after=snapshotTree(workspace.scratchPlugin,true),baseAfter=snapshotTree(workspace.basePlugin,false);clean=auditWorkspace(workspace,before,after,expectedDigests)&&snapshotsMatch(workspace.baseMetadata,baseAfter);}catch{clean=false;}
    metrics.resetVerifyMs+=tick()-verifyStarted;
    let workspaceReusable=false;
    if(!clean||raw.spawnError||raw.signal||raw.crashed){metrics.contaminated=!clean;const cleanup=tick();discardWorkspace(workspace);metrics.cleanupMs+=tick()-cleanup;}
    else{
        const cleanup=tick();try{restoreWorkspacePaths(workspace,changed);workspaceReusable=true;}catch{metrics.contaminated=true;discardWorkspace(workspace);}metrics.cleanupMs+=tick()-cleanup;
    }
    if(metrics.cacheEnabled&&workspaceReusable&&cacheable(raw))cacheRaw(conditionFingerprint,raw);
    return materializeDeletion(raw,options);
}
export function body_deletion_regression(suiteFile:string,skillRoot:string,options:DeletionOptions={}):DeletionResult|typeof _DELETION_SKIPPED|null {
    if(in_deleted_run())return null;if(deletion_skipped())return _DELETION_SKIPPED;
    const started=tick(),metrics:DeletionTiming={logicalOrdinal:++_DELETION_LOGICAL_COUNT,sourceFingerprint:null,conditionFingerprint:null,eligible:false,cacheEnabled:process.env.JSTACK_DELETION_OPTIMIZE!=='0'&&process.env.JSTACK_DELETION_RESULT_CACHE==='1',workspaceReused:false,cacheHit:false,physicalExecution:false,contaminated:false,rc:null,crashed:null,fingerprintMs:0,copyMs:0,copyVerifyMs:0,resetMs:0,resetVerifyMs:0,runMs:0,cleanupMs:0,totalMs:0};installDeletionExitCleanup();
    try{const result=process.env.JSTACK_DELETION_OPTIMIZE==='0'?ordinaryDeletionRun(suiteFile,skillRoot,options,metrics):optimizedDeletionRun(suiteFile,skillRoot,options,metrics);metrics.totalMs=tick()-started;recordDeletionTiming(metrics);return result;}
    catch(error){metrics.totalMs=tick()-started;recordDeletionTiming(metrics);throw error;}
}
function walk(root:string,acceptDir:(name:string,parent:string)=>boolean=()=>true):[string,string[]][] {if(!presentDir(root))return[];const out:[string,string[]][]=[];function visit(path:string){const entries=readdirSync(path,{withFileTypes:true});out.push([path,entries.filter(entry=>!entry.isDirectory()&&!(entry.isSymbolicLink()&&presentDir(join(path,entry.name)))).map(entry=>entry.name)]);for(const entry of entries)if(entry.isDirectory()&&acceptDir(entry.name,path))visit(join(path,entry.name));}visit(root);return out;}
export interface CoverageOptions extends DeletionOptions {per_file:Record<string,number>;live_ran?:number|null;measure?:boolean;completeness?:boolean;}
export function _floor_unmeasured(check:Check,rel:string,floor:number,why:string):void{check(`계약 커버리지: ${rel}`,false,`측정 불가 (하한 ${floor}) — ${why}`);}
function lastError(result:DeletionResult):string{return lines(result.stderr.trim()).at(-1)?.slice(0,80)??'';}
export function check_contract_coverage(check:Check,suiteFile:string,skillRoot:string,options:CoverageOptions):void{
    if(in_deleted_run())return;
    const excluded=new Set(['scripts','tests','assets','scheduler','templates','__pycache__','node_modules','dist','.omc','results','.git','.ruff_cache','repos']);
    const suffixes=['.py','.js','.mjs','.cjs','.ts','.sh','.ps1','.json','.jsonl','.txt','.plist','.service','.toml','.pyc'];
    const expected=new Set<string>();
    for(const [path,files] of walk(skillRoot,(name,parent)=>!(excluded.has(name)&&(name!=='templates'||parent===skillRoot))&&!(basename(parent)==='skills'&&parent!==skillRoot&&presentFile(join(parent,name,'SKILL.md')))))
        for(const name of files)if(!name.startsWith('.')&&!suffixes.some(suffix=>name.endsWith(suffix)))expected.add(posix(relative(skillRoot,join(path,name))));
    const missing=sorted([...expected].filter(name=>!Object.hasOwn(options.per_file,name))),stale=sorted(Object.keys(options.per_file).filter(name=>!existsSync(join(skillRoot,name))));
    if(options.completeness!==false)check('계약 커버리지: 선언 목록이 실제 파일과 일치한다',!missing.length&&!stale.length,(missing.length?`미선언 ${repr(missing)} `:'')+(stale.length?`없는파일 ${repr(stale)}`:''));
    if(options.measure===false)return;
    for(const rel of sorted(Object.keys(options.per_file))){const floor=options.per_file[rel];if(floor<1){check(`계약 커버리지: ${rel} 의 바닥값이 1 이상이다`,false,`${floor} — 계약 없는 파일을 선언했다`);continue;}const result=body_deletion_regression(suiteFile,skillRoot,{only:rel,runner:options.runner,extra_skip:options.extra_skip});if(result===null)continue;if(result===_DELETION_SKIPPED){_skip_named(`계약 커버리지: ${rel}`);continue;}if(![0,1].includes(result.rc)||result.crashed){check(`계약 커버리지: ${rel} 비운 사본이 완주한다`,false,lastError(result));_floor_unmeasured(check,rel,floor,'copy did not complete');continue;}if(options.live_ran!=null&&result.ran<options.live_ran){check(`계약 커버리지: ${rel} 비워도 검사가 소멸하지 않는다`,false,`사본 ${result.ran}건 / 실제 ${options.live_ran}건`);_floor_unmeasured(check,rel,floor,`소멸 가드가 걸렸다 (사본 ${result.ran}/${options.live_ran})`);continue;}check(`계약 커버리지: ${rel}`,result.fails>=floor,`${result.fails}건 실패 (하한 ${floor})`);}
}
export function check_body_deletion(check:Check,suiteFile:string,skillRoot:string,options:DeletionOptions&{minimum:number;live_ran?:number|null}):void{
    const result=body_deletion_regression(suiteFile,skillRoot,options);if(result===null)return;
    if(result===_DELETION_SKIPPED){const names=['자기검사: 본문 삭제 사본이 완주한다 (비정상 종료 아님)'];if(options.live_ran!=null)names.push('자기검사: 사본에서 검사가 소멸하지 않았다');names.push('자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다');_skip_named(...names);return;}
    check('자기검사: 본문 삭제 사본이 완주한다 (비정상 종료 아님)',[0,1].includes(result.rc)&&!result.crashed,result.crashed?'traceback: '+lastError(result):`rc=${result.rc}`);
    if(options.live_ran!=null)check('자기검사: 사본에서 검사가 소멸하지 않았다',result.ran>=options.live_ran,`사본 ${result.ran}건 / 본문검사 ${options.live_ran}건`);
    check('자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다',result.fails>=options.minimum,`${result.fails}건 실패 (하한 ${options.minimum})`);
}
export class _Section {
    private at:number;
    constructor(private check:Check,private results:Result[],private names:string[]){this.at=results.length;}
    /** A callback replaces Python's with-block and always retains missing axes. */
    run(callback:()=>void):void{this.at=this.results.length;let why='missing artifact';try{callback();}catch(error){why=error instanceof Error?`${error.name}: ${error.message}`:String(error);}finally{const emitted=new Set(this.results.slice(this.at).map(result=>result[0]));for(const name of this.names)if(!emitted.has(name))this.check(name,false,why.slice(0,120));}}
}
export function section(check:Check,results:Result[],...names:string[]):_Section{return new _Section(check,results,names);}
export function read_ref(path:string):string|null{return existsSync(path)?readFileSync(path,'utf8'):null;}
export function content_bytes(text:string,needles:Iterable<string>=[]):number{
    text=text.replaceAll('${JSTACK_PLUGIN_ROOT}','${CLAUDE_PLUGIN_ROOT}');
    const normalized=[...needles].map(needle=>needle.replaceAll('${JSTACK_PLUGIN_ROOT}','${CLAUDE_PLUGIN_ROOT}'));
    const seen=new Set<string>();let total=0;
    for(const line of lines(text)){const stripped=line.trim();if(!stripped||seen.has(stripped))continue;seen.add(stripped);let body=stripped.replace(/^```.*$/,'').replace(/^[#\->*|:\s]+|[|\s]+$/g,'');for(const needle of normalized)body=body.replaceAll(needle,'');body=body.replace(/[\s\-|*`]+/g,'');total+=Buffer.byteLength(body,'utf8');}return total;
}
export function _worktree_blob(path:string):string|null{const result=git(['hash-object',resolve(path)],dirname(path)||'.');return result.status===0?result.stdout.trim():null;}
export function _committed_blob(path:string):string|null{const repo=git(['rev-parse','--show-toplevel'],dirname(path)||'.');if(repo.status!==0)return null;const root=repo.stdout.trim();const rel=posix(relative(real(root),real(path)));const result=git(['rev-parse',`HEAD:${rel}`],root);return result.status===0?result.stdout.trim():null;}
export function ref_lines(text:string):string[]{return lines(text).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);}
/** difflib.SequenceMatcher(autojunk=False), including earliest-match tie breaking. */
export function survival_rate(live:string[],frozen:string[]):number {return frozen.length?matchingBlockCount(frozen,live)/frozen.length:0;}

function readText(path:string):string{return readFileSync(path,'utf8');}
export function _freeze_guard(check:Check,fn:string,fp:string,frozenPath:string,raw:string[],labelPrefix:string):[string[],boolean]{
    if(in_deleted_run())return[raw.filter(line=>!!line&&!line.startsWith('# blob:')),true];
    const header=raw.find(line=>line.startsWith('# blob:'));if(header===undefined){check(`자기검사: ${fn} 동결본에 출처 blob 이 있다`,false,'missing header; handmade frozen references are rejected');return[[],false];}
    const frozen=raw.filter(line=>!!line&&!line.startsWith('# blob:'));
    if(!_in_git_repo(fp)){const expected=ref_lines(fn==='SKILL.md'?split_frontmatter(readText(fp))[1]:readText(fp));const same=JSON.stringify(expected)===JSON.stringify(frozen);check(`자기검사: ${fn} 동결본이 현재 문서에서 나왔다 (git 밖)`,same,'payload differs from the document; outside Git, commit comparison is unavailable, but derivation from this document is still checked');return[frozen,same];}
    const declared=header.slice(header.indexOf(':')+1).trim(),committed=_committed_blob(fp);
    if(committed===null&&_in_git_repo(fp)){check(`자기검사: ${fn} 이 커밋돼 있다`,false,'untracked reference; commit it and freeze with FREEZE_REFS=1');return[frozen,false];}
    const frozenCommitted=_committed_blob(frozenPath);
    if(frozenCommitted!==null){const same=_worktree_blob(frozenPath)===frozenCommitted;check(`자기검사: ${fn} 동결본이 커밋된 그대로다`,same,same?'':'.lines differs from its commit; commit reference updates to retain a reviewable diff');if(!same)return[frozen,false];}
    else if(_in_git_repo(frozenPath)){check(`자기검사: ${fn} 동결본이 커밋돼 있다`,false,'untracked frozen reference; commit it before using it as evidence');return[frozen,false];}
    const source=git(['cat-file','blob',declared],dirname(resolve(fp)));
    if(source.status===0){const[,body]=split_frontmatter(source.stdout);const expected=ref_lines(fn==='SKILL.md'?body:source.stdout),same=JSON.stringify(expected)===JSON.stringify(frozen);check(`자기검사: ${fn} 동결본 내용이 헤더의 blob 과 일치한다`,same,`선언 blob ${declared.slice(0,12)} / 정답지 ${frozen.length}줄`);if(!same)return[frozen,false];}
    else if(_in_git_repo(fp)){check(`자기검사: ${fn} 헤더가 가리키는 blob 을 꺼낼 수 있다`,false,`git cat-file 실패 — ${declared.slice(0,12)} 를 이 저장소에서 찾을 수 없다`);return[frozen,false];}
    if(committed!==null){const ok=declared===committed;check(`자기검사: ${fn} 동결본이 커밋된 문서에서 나왔다`,ok,ok?'':`동결본은 ${declared.slice(0,12)} 를 가리키는데 HEAD 는 ${committed.slice(0,12)} ; after document edits, commit and refreeze with FREEZE_REFS=1`);if(!ok)return[frozen,false];}
    if(!frozen.length){check(`${labelPrefix}: ${fn} 동결본이 비어 있지 않다`,false,'0줄');return[frozen,false];}return[frozen,true];
}
export function _ref_axes(check:Check,skillRoot:string,fn:string,fp:string,body:string,needles:string[],floor:number,freezeDir:string,labelPrefix:string):void{
    const missing=needles.filter(needle=>!body.includes(needle));check(`${labelPrefix}: ${fn} 의 needle 이 살아 있다`,!missing.length,`누락 ${repr(missing)}`);
    const got=content_bytes(body,needles);check(`${labelPrefix}: ${fn} 부피 (>= ${floor}B)`,got>=floor,`${got}B`);
    const freezeRoot=join(skillRoot,freezeDir),frozenPath=join(freezeRoot,fn+'.lines'),live=ref_lines(body);
    if(process.env.FREEZE_REFS){mkdirSync(freezeRoot,{recursive:true});writeFileSync(frozenPath,`# blob:${_worktree_blob(fp)??'UNTRACKED'}\n`+live.join('\n'));check(`${labelPrefix}: ${fn} 동결본을 새로 썼다 (FREEZE_REFS)`,false,`${live.length}줄 — 갱신을 커밋으로 남기고 재실행하라`);return;}
    if(!existsSync(frozenPath)){check(`${labelPrefix}: ${fn} 줄 생존율`,false,`동결본 부재 (${freezeDir}/${fn}.lines) — FREEZE_REFS=1 로 동결하라`);return;}
    const[frozen,ok]=_freeze_guard(check,fn,fp,frozenPath,lines(readText(frozenPath)),labelPrefix);if(!ok)return;if(!_in_git_repo(fp)&&!in_deleted_run())return;
    const rate=survival_rate(live,frozen);
    check(`자기검사: ${fn} 줄 생존율 (>= ${Math.round(SURVIVAL_FLOOR*100)}%, 순서 포함)`,rate >= SURVIVAL_FLOOR,`${Math.round(rate*100)}% (${Math.trunc(rate*frozen.length)}/${frozen.length}줄)`);
}
export type RefContract=[string,string,string[],number];
export interface RefOptions {semantic?:string[];label_prefix?:string;freeze_dir?:string;subdir?:string;population?:Iterable<string>|null;}
export function check_ref_contracts(check:Check,skillRoot:string,contracts:RefContract[],options:RefOptions={}):void{
    const label=options.label_prefix??'참조 계약',freezeDir=options.freeze_dir??'tests/refs',subdir=options.subdir??'references',freezeRoot=join(skillRoot,freezeDir),refsDir=join(skillRoot,subdir);
    if(presentDir(refsDir)){const declared=new Set(contracts.map(c=>c[0]));let actual=readdirSync(refsDir).filter(name=>name.endsWith('.md'));if(options.population!=null){const population=new Set([...options.population].map(name=>name.endsWith('.md')?name:name+'.md'));actual=actual.filter(name=>population.has(name));}const gap=sorted(actual.filter(name=>!declared.has(name)));check(`${label}: 계약 목록이 ${subdir}/ 전부를 덮는다`,!gap.length,`계약 밖 ${repr(gap)}`);}
    for(const[fn,desc,needles,floor]of contracts){const fp=join(skillRoot,subdir,fn);if(!existsSync(fp)){check(`${label}: ${fn} 실재`,false,'파일 없음');continue;}const body=readText(fp),missing=needles.filter(needle=>!body.includes(needle));check(`${label}: ${fn} — ${desc}`,!missing.length,`누락 ${repr(missing)}`);if(options.semantic?.includes(fn))continue;const got=content_bytes(body,needles);check(`${label}: ${fn} 부피 (>= ${floor}B)`,got>=floor,`${got}B`);const live=ref_lines(body),frozenPath=join(freezeRoot,fn+'.lines');
        if(process.env.FREEZE_REFS){mkdirSync(freezeRoot,{recursive:true});writeFileSync(frozenPath,`# blob:${_worktree_blob(fp)??'UNTRACKED'}\n`+live.join('\n'));check(`${label}: ${fn} 동결본을 새로 썼다 (FREEZE_REFS)`,false,`${live.length}줄 — 갱신을 커밋으로 남기고 재실행하라`);continue;}
        if(!existsSync(frozenPath)){check(`${label}: ${fn} 줄 생존율`,false,`동결본 부재 (${freezeDir}/${fn}.lines) — for an intentional update, rerun with FREEZE_REFS=1`);continue;}
        const[frozen,ok]=_freeze_guard(check,fn,fp,frozenPath,lines(readText(frozenPath)),label);if(!ok)continue;if(!_in_git_repo(fp)&&!in_deleted_run())continue;const rate=survival_rate(live,frozen);
        check(`자기검사: ${fn} 줄 생존율 (>= ${Math.round(SURVIVAL_FLOOR*100)}%, 순서 포함)`,rate >= SURVIVAL_FLOOR,`${Math.round(rate*100)}% (${Math.trunc(rate*frozen.length)}/${frozen.length}줄)`);
    }
}
export function check_total(check:Check,results:Result[],expected:number):void{if(in_deleted_run())return;reach_dump(results.map(result=>result[0]));const environmental=['동결본이 커밋된 문서에서 나왔다','이 커밋돼 있다','동결본이 커밋된 그대로다','헤더의 blob 과 일치한다','가리키는 blob 을 꺼낼 수 있다','동결본이 현재 문서에서 나왔다 (git 밖)','줄 생존율'];const counted=results.filter(result=>!environmental.some(marker=>result[0].includes(marker))),got=counted.length+1+_SKIPPED_NAMES.length;check(`자기검사: 검사 총수가 ${expected} 건이다`,got===expected,`${got}건`+(_SKIPPED_NAMES.length?` (삭제 회귀 생략 ${_SKIPPED_NAMES.length}건 포함)`:'')+' ; update this count when adding or removing contracts');}
export function _script_floor_unmeasured(check:Check,rel:string,floor:number,why:string):void{check(`스크립트 계약: ${rel}`,false,`측정 불가 (하한 ${floor}) — ${why}`);}
export function check_script_contracts(check:Check,suiteFile:string,skillRoot:string,options:DeletionOptions&{scripts:Record<string,number>;live_ran?:number|null}):void{
    if(in_deleted_run())return;for(const rel of sorted(Object.keys(options.scripts))){const floor=options.scripts[rel];if(floor<1){check(`스크립트 계약: ${rel} 하한이 1 이상이다`,false,`하한 ${floor} — 계약 없는 스크립트를 선언했다`);continue;}const result=body_deletion_regression(suiteFile,skillRoot,{only:rel,runner:options.runner,extra_skip:options.extra_skip});if(result===null)continue;if(result===_DELETION_SKIPPED){_skip_named(`스크립트 계약: ${rel}`);continue;}if(![0,1].includes(result.rc)||result.crashed){check(`스크립트 계약: ${rel} 비운 사본이 완주한다`,false,lastError(result));_script_floor_unmeasured(check,rel,floor,'copy did not complete');continue;}if(options.live_ran==null){check(`스크립트 계약: ${rel} 소멸 가드가 걸려 있다`,false,'live_ran is missing; the declared axis is effectively disabled');_script_floor_unmeasured(check,rel,floor,'survival guard not configured');continue;}if(result.ran<options.live_ran){check(`스크립트 계약: ${rel} 비워도 검사가 소멸하지 않는다`,false,`사본 ${result.ran}건 / 실제 ${options.live_ran}건`);_script_floor_unmeasured(check,rel,floor,`소멸 가드가 걸렸다 (사본 ${result.ran}/${options.live_ran})`);continue;}check(`스크립트 계약: ${rel}`,result.fails>=floor,`${result.fails}건 실패 (하한 ${floor})`);}
}
export function check_description(check:Check,skillRoot:string,fm:string,options:{floor?:number}={}):void{
    const description=/^description:[ \t]*(.*(?:\n[ \t]+.*)*)/m.exec(fm)?.[1]?.replace(/^[>|]-?[ \t]*\n?/, '').trim();const valid=/^name:[ \t]*[a-z][a-z0-9-]*[ \t]*$/m.test(fm)&&!!description;check('L0: description metadata is nonempty',valid,'name and a nonempty description are required; length is not quality');
    const rels=sorted(new Set([...fm.matchAll(/`((?:references|scripts|tests)\/[\p{L}\p{N}_./-]+)`/gu)].map(match=>match[1])));
    if(rels.length){const missing=rels.filter(rel=>!existsSync(join(skillRoot,rel)));check('L0: description 이 부르는 경로가 실재한다',!missing.length,missing.length?`없는 경로 ${repr(missing)}`:`${rels.length}건`);}
    const skillsDir=dirname(resolve(skillRoot)),named=new Set([...fm.matchAll(/`([a-z][a-z0-9-]{2,})`\s*(?:skill|스킬)/g)].map(match=>match[1]));
    if(named.size){const gone=sorted([...named].filter(name=>!presentDir(join(skillsDir,name))));check('L0: description 이 지목한 이웃 스킬이 실재한다',!gone.length,gone.length?`없는 이웃 ${repr(gone)}`:repr(sorted(named)));}
}
export interface BodyPathOptions {label_prefix?:string;fm_of_skill?:string;orphan_skip?:Record<string,string>|null;}
export function check_body_paths(check:Check,skillRoot:string,body:string,options:BodyPathOptions={}):void{
    const label=options.label_prefix??'본문 계약',orphanSkip=options.orphan_skip??{};
    for(const sub of sorted(Object.keys(orphanSkip)))check(`${label}: 고아 모집단에서 ${sub} 를 뺀 사유가 있다`,!!String(orphanSkip[sub]).trim(),'no reason provided');
    if(!body.trim()){for(const name of ['본문이 부르는 스킬 안 경로가 전부 실재한다','실행 경로가 실재하는 스킬을 가리킨다','실행 경로의 대상 파일이 실재한다','부속 파일이 전부 어디선가 인용된다 (고아 0)','플러그인 루트 토큰이 지원하는 호스트 표기다'])check(`${label}: ${name}`,false,'empty body; no population to measure');return;}
    const rels=sorted(new Set([...body.matchAll(/`((?:references|scripts|tests)\/[\p{L}\p{N}_./-]+)`/gu)].map(match=>match[1]))),missing=rels.filter(rel=>!existsSync(join(skillRoot,rel)));
    check(`${label}: 본문이 부르는 스킬 안 경로가 전부 실재한다`,!missing.length,missing.length?`없는 경로 ${repr(missing)}`:`${rels.length}건`);
    const own=basename(resolve(skillRoot)),skillsDir=dirname(resolve(skillRoot)),pluginRoot=dirname(skillsDir);
    const runs=[...body.matchAll(/\$\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\}\/skills\/([\p{L}\p{N}_.-]+)\/([\p{L}\p{N}_./-]+)/gu)].map(match=>[match[1],match[2]]);
    const badSkill=sorted(new Set(runs.map(([skill])=>skill).filter(skill=>!presentDir(join(skillsDir,skill))))),badRelative=new Set<string>();
    for(const[skill,rel]of runs){const base=skill===own?skillRoot:join(skillsDir,skill);if(presentDir(base)&&!existsSync(join(base,rel)))badRelative.add(`${skill}/${rel}`);}
    const rootRels=new Set([...body.matchAll(/\$\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\}\/([\p{L}\p{N}_./-]+)/gu)].map(match=>match[1]).filter(rel=>!rel.startsWith('skills/')));for(const rel of rootRels)if(!existsSync(join(pluginRoot,rel)))badRelative.add(rel);
    const badRel=sorted(badRelative);check(`${label}: 실행 경로가 실재하는 스킬을 가리킨다`,!badSkill.length,badSkill.length?`없는 스킬 ${repr(badSkill)}`:`${runs.length}건`);check(`${label}: 실행 경로의 대상 파일이 실재한다`,!badRel.length,badRel.length?`없는 대상 ${repr(badRel)}`:`${runs.length}건`);
    const reachParts:Record<string,string>={__fm__:options.fm_of_skill??'',__body__:body};
    for(const sub of ['references','scripts'])for(const[path,files]of walk(join(skillRoot,sub),name=>!['__pycache__','.ruff_cache'].includes(name)))for(const name of files){if(name.endsWith('.pyc')||name.endsWith('.lines'))continue;try{reachParts[posix(relative(skillRoot,join(path,name)))]=readText(join(path,name));}catch{}}
    const owned:string[]=[];
    for(const sub of ['references','scripts']){if(Object.hasOwn(orphanSkip,sub))continue;for(const[path,files]of walk(join(skillRoot,sub),name=>!['__pycache__','tests','.ruff_cache'].includes(name)&&!name.startsWith('_')&&!name.startsWith('.')))for(const name of sorted(files)){if(name.startsWith('.')||name.startsWith('_')||name.endsWith('.pyc')||name.endsWith('.lines'))continue;owned.push(posix(relative(skillRoot,join(path,name))));}}
    const suffixes=(rel:string)=>rel.split('/').map((_,index,parts)=>parts.slice(index).join('/'));
    const counts=new Map<string,number>();for(const rel of owned)for(const suffix of suffixes(rel))counts.set(suffix,(counts.get(suffix)??0)+1);
    const reachable=(rel:string):boolean=>{
        // A compiled artifact cannot acquire reachability by citing itself in its
        // authored companion. Both files represent the same executable subject.
        const companion=rel.endsWith('.js')?rel.slice(0,-3)+'.ts':null;
        const others=Object.entries(reachParts).filter(([key])=>key!==rel&&key!==companion).map(([,value])=>value).join('\n');
        const localLines=lines(others).filter(line=>!line.includes('://'));
        return suffixes(rel).some(suffix=>counts.get(suffix)===1&&localLines.some(line=>line.includes(suffix)));
    };
    const orphan=sorted(owned.filter(rel=>{
        if(reachable(rel))return false;
        if(rel.endsWith('.ts')&&!rel.endsWith('.d.ts')){
            const executable=rel.slice(0,-3)+'.js';
            if(presentFile(join(skillRoot,executable))&&owned.includes(executable)&&reachable(executable))return false;
        }
        return true;
    }));
    check(`${label}: 부속 파일이 전부 어디선가 인용된다 (고아 0)`,!orphan.length,orphan.length?`고아 ${repr(orphan)}`:`${owned.length}건`);
    const stray=sorted(new Set([...body.matchAll(/\$\{([A-Z_]*PLUGIN_ROOT)\}/g)].map(match=>match[1]).filter(name=>!['CLAUDE_PLUGIN_ROOT','JSTACK_PLUGIN_ROOT'].includes(name))));check(`${label}: 플러그인 루트 토큰이 지원하는 호스트 표기다`,!stray.length,`다른 토큰 ${repr(stray)}`);
}
export function check_skill_body(check:Check,skillRoot:string,options:{needles:string[];floor:number;semantic?:boolean;freeze_dir?:string;orphan_skip?:Record<string,string>|null}):void{
    if(options.floor<1){check('본문 계약: SKILL.md 부피 하한이 1 이상이다',false,`하한 ${options.floor} — 계약 없는 본문을 선언했다`);return;}
    const fp=join(skillRoot,'SKILL.md'),[fm,body]=split_frontmatter(readText(fp));check_description(check,skillRoot,fm);if(options.semantic){const missing=options.needles.filter(n=>!body.includes(n));check('본문 계약: required behavioral clauses',options.needles.length>0&&!missing.length,`missing ${repr(missing)}`);}else _ref_axes(check,skillRoot,'SKILL.md',fp,body,options.needles,options.floor,options.freeze_dir??'tests/refs','본문 계약');check_body_paths(check,skillRoot,body,{fm_of_skill:fm,orphan_skip:options.orphan_skip});
}
export function _criteria_values(text:string):Set<string>{
    const body=text.split(/^##+\s*(?:실패|Failure)/m,1)[0],out=new Set<string>();
    for(const match of [...body.matchAll(/\*\*([^*\n]{2,60})\*\*/gu),...body.matchAll(/`([^`\n]{2,60})`/gu)]){const value=match[1].trim().replace(/^[*`]+|[*`]+$/g,'').trim();if(/^\d+\.\s/.test(value)||value.includes('/')||['통과 조건','Both passing conditions','One passing condition'].some(prefix=>value.startsWith(prefix)))continue;if([...value].length>20&&(/다\.?$/.test(value)))continue;if([...value].length<3)continue;out.add(value);}
    for(const match of body.matchAll(/^\|(.+)\|$/gm))for(const cell of match[1].split('|')){const value=cell.trim().replace(/^[*`]+|[*`]+$/g,'').trim(),length=[...value].length;if(length>=3&&length<=40&&/\d/.test(value)&&!value.startsWith('-'))out.add(value);}return out;
}
export interface EvalOptions {tag:string;discriminating:Iterable<string>;answer_tokens:Record<string,string[]>;}
export function check_eval_cases(check:Check,pluginRoot:string,repo:string,tagReader:(text:string)=>Iterable<string>,options:EvalOptions):void{
    const base=join(pluginRoot,'evals'),cases=walk(base).filter(([,files])=>files.includes('case.yaml')).map(([path])=>[posix(relative(base,path)),join(path,'case.yaml')]).sort(([a],[b])=>unicodeOrder(a,b));check('평가 케이스가 존재한다',cases.length>0,`${cases.length}건`);
    for(const[rel,path]of cases){const graders=join(dirname(path),'graders'),fired:[string,string][]=[];if(presentDir(graders))for(const name of sorted(readdirSync(graders))){if(!name.endsWith('.md'))continue;const text=read_ref(join(graders,name))??'';if(/^type:\s*tool_used\s*$/m.test(text))fired.push([name,text]);}check(`발동 계측: ${rel} 에 tool_used 채점기가 있다`,fired.length>0,'only content grading is present; invocation cannot be distinguished');for(const[name,text]of fired){check(`발동 계측: ${rel}/${name} 이 점수가 아니라 지표다`,!/^weight:/m.test(text),'declared weight inflates delta');check(`발동 계측: ${rel}/${name} 이 Skill 도구를 겨냥한다`,/^tool:\s*Skill\s*$/m.test(text),'tool: Skill is required');}}
    const unsafe:[RegExp,string][]=[[/\\A/,'JavaScript has no `\\A` anchor; it reads literal A. Use `^`'],[/\\Z/,'JavaScript reads `\\Z` as literal Z. Use `$`'],[/\\z/,'JavaScript reads `\\z` as literal z. Use `$`'],[/\(\?P</,'JavaScript named groups use `(?<name>...)`'],[/\(\?[a-z]+\)/,'JavaScript has no inline `(?s)` flags; use `flags:`'],[/\(\?#/,'JavaScript has no `(?#...)` comment groups']];
    for(const[rel,path]of cases){const graders=join(dirname(path),'graders');if(!presentDir(graders))continue;for(const name of sorted(readdirSync(graders))){if(!name.endsWith('.md'))continue;const text=read_ref(join(graders,name))??'';if(!/^type:\s*regex\s*$/m.test(text))continue;const match=/^pattern:\s*"(.*)"\s*$/m.exec(text);check(`정규식 채점기: ${rel}/${name} 이 pattern 을 선언한다`,!!match,'pattern line is missing or not double-quoted');if(!match)continue;const hits=unsafe.filter(([pattern])=>pattern.test(match[1])).map(([,why])=>why);check(`정규식 채점기: ${rel}/${name} 이 JS 에서 같은 뜻이다`,!hits.length,hits.join('; '));}}
    const found=new Set<string>(),untagged:string[]=[];for(const[rel,path]of cases){const tags=[...tagReader(readText(path))];if(!tags.length)untagged.push(rel);if(tags.includes(options.tag))found.add(rel);}check('모든 케이스가 tags 를 선언한다',!untagged.length,repr(untagged));const declared=new Set(options.discriminating),missing=sorted([...declared].filter(name=>!found.has(name))),extra=sorted([...found].filter(name=>!declared.has(name)));check(`판별 케이스가 정확히 ${declared.size}개다`,!missing.length&&!extra.length,`빠짐 ${repr(missing)} / 추가 ${repr(extra)}`);
    for(const[rel,path]of cases){const tracked=git(['ls-files','--error-unmatch','--',path],repo),difference=git(['diff','--quiet','HEAD','--',path],repo);if(difference.status===128)check(`case.yaml 이 git 에 있다: ${rel}`,false,'git 밖');else check(`case.yaml 이 커밋본과 같다: ${rel}`,difference.status===0&&tracked.status===0,tracked.status!==0?'untracked; not committed':'modified in the working tree; changing tags can bypass the gate');}
    for(const rel of sorted(Object.keys(options.answer_tokens))){const tokens=options.answer_tokens[rel],dir=join(base,rel),prompt=read_ref(join(dir,'prompt.md'))??'',criteria=read_ref(join(dir,'graders','criteria.md'))??'';check(`정답 위치: ${rel} 정답 토큰이 선언돼 있다`,tokens.length>=2&&tokens.every(token=>[...token].length>=2),repr(tokens));const automatic=_criteria_values(criteria),leak=sorted(new Set([...tokens,...automatic].filter(token=>!!token&&prompt.includes(token)))),missing=tokens.filter(token=>!criteria.includes(token)),uncovered=sorted([...automatic].filter(value=>!tokens.some(token=>value.includes(token)||token.includes(value))));check(`정답 위치: ${rel} 프롬프트가 정답을 흘리지 않는다`,!leak.length,`프롬프트에 있다: ${repr(leak)}`);check(`정답 위치: ${rel} 채점 기준이 정답을 담는다`,!missing.length,`기준에 없다: ${repr(missing)}`);check(`정답 위치: ${rel} 선언이 기준의 값을 빠짐없이 덮는다`,!uncovered.length,`손목록 밖: ${repr(uncovered)}`);}
    const untaggedEligible=sorted(Object.keys(options.answer_tokens).filter(rel=>!found.has(rel))),taggedIneligible=sorted([...found].filter(rel=>!Object.hasOwn(options.answer_tokens,rel)));check('자격: 정답 토큰을 가진 케이스는 전부 태그를 단다',!untaggedEligible.length,`태그 없음: ${repr(untaggedEligible)}`);check('자격: 태그가 붙은 케이스는 전부 정답 토큰을 갖는다',!taggedIneligible.length,`토큰 없음: ${repr(taggedIneligible)}`);
}
/** Enumerate finite AST shapes without evaluating code supplied by a suite. */
export function constant_assertions(sources:{name:string;text:string}[]):string[]{
    const roots=sources.map(source=>ts.createSourceFile(source.name,source.text,ts.ScriptTarget.Latest,true,source.name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS));
    const all:ts.Node[]=[];
    const visit=(node:ts.Node):void=>{all.push(node);ts.forEachChild(node,visit);};roots.forEach(visit);
    const strip=(input:ts.Node):ts.Node=>{let node=input;while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node)||ts.isNonNullExpression(node)||ts.isSatisfiesExpression(node))node=node.expression;return node;};
    const source=(node:ts.Node):string=>{const print=ts.createPrinter({removeComments:true});return print.printNode(ts.EmitHint.Unspecified,strip(node),node.getSourceFile()).replace(/\s+/g,' ').trim();};
    const bindings=(node:ts.Node):string[]=>{if(ts.isIdentifier(node))return[node.text];if(ts.isObjectBindingPattern(node)||ts.isArrayBindingPattern(node))return node.elements.flatMap(element=>ts.isBindingElement(element)?bindings(element.name):[]);return[];};
    const assigned=new Map<string,number>(),single=new Map<string,ts.Expression>(),candidate=new Set<string>();
    const UNKNOWN=Symbol('unknown');
    function literal(input:ts.Node):unknown{
        const node=strip(input);
        if(ts.isStringLiteralLike(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
        if(ts.isNumericLiteral(node))return Number(node.text);
        if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
        if(ts.isIdentifier(node)&&node.text==='undefined')return undefined;
        if(ts.isArrayLiteralExpression(node)){const values=node.elements.map(literal);return values.some(value=>value===UNKNOWN)?UNKNOWN:values;}
        if(ts.isObjectLiteralExpression(node)){const object:Record<string,unknown>={};for(const property of node.properties){if(!ts.isPropertyAssignment(property)||(!ts.isIdentifier(property.name)&&!ts.isStringLiteral(property.name)&&!ts.isNumericLiteral(property.name)))return UNKNOWN;const value=literal(property.initializer);if(value===UNKNOWN)return UNKNOWN;object[property.name.text]=value;}return object;}
        if(ts.isPrefixUnaryExpression(node)){const value=literal(node.operand);if(value===UNKNOWN)return UNKNOWN;if(node.operator===ts.SyntaxKind.ExclamationToken)return !value;if(node.operator===ts.SyntaxKind.MinusToken&&typeof value==='number')return-value;if(node.operator===ts.SyntaxKind.PlusToken&&typeof value==='number')return value;}
        if(ts.isPropertyAccessExpression(node)&&node.name.text==='length'){const value=literal(node.expression);if(typeof value==='string'||Array.isArray(value))return value.length;}
        if(ts.isBinaryExpression(node)){const left=literal(node.left),right=literal(node.right);if(left===UNKNOWN||right===UNKNOWN)return UNKNOWN;switch(node.operatorToken.kind){case ts.SyntaxKind.EqualsEqualsEqualsToken:return left===right;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return left!==right;case ts.SyntaxKind.EqualsEqualsToken:return left==right;case ts.SyntaxKind.ExclamationEqualsToken:return left!=right;case ts.SyntaxKind.LessThanToken:return (left as any)<right!;case ts.SyntaxKind.LessThanEqualsToken:return(left as any)<=right!;case ts.SyntaxKind.GreaterThanToken:return(left as any)>right!;case ts.SyntaxKind.GreaterThanEqualsToken:return(left as any)>=right!;case ts.SyntaxKind.AmpersandAmpersandToken:return left&&right;case ts.SyntaxKind.BarBarToken:return left||right;case ts.SyntaxKind.QuestionQuestionToken:return left??right;case ts.SyntaxKind.PlusToken:if(typeof left==='number'&&typeof right==='number')return left+right;if(typeof left==='string'&&typeof right==='string'&&left.length+right.length<100000)return left+right;return UNKNOWN;case ts.SyntaxKind.MinusToken:return typeof left==='number'&&typeof right==='number'?left-right:UNKNOWN;default:return UNKNOWN;}}
        if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.arguments.length===1){const value=literal(node.arguments[0]);if(value===UNKNOWN)return UNKNOWN;if(node.expression.text==='Boolean')return Boolean(value);if(node.expression.text==='truth'){if(Array.isArray(value)||typeof value==='string')return value.length>0;if(value!==null&&typeof value==='object')return Object.keys(value).length>0;return Boolean(value);}if(node.expression.text==='String'&&['string','number','boolean','undefined'].includes(typeof value))return String(value);}
        return UNKNOWN;
    }
    const addAssignment=(name:string,value?:ts.Expression,loop=false)=>{assigned.set(name,(assigned.get(name)??0)+(loop?2:1));if(value)single.set(name,value);if(value&&(ts.isStringLiteralLike(strip(value))||ts.isNumericLiteral(strip(value))||strip(value).kind===ts.SyntaxKind.TrueKeyword)&&Boolean(literal(value)))candidate.add(name);};
    for(const node of all){if(ts.isVariableDeclaration(node)){for(const name of bindings(node.name))addAssignment(name,node.initializer);}else if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment){for(const name of bindings(node.left))addAssignment(name,node.operatorToken.kind===ts.SyntaxKind.EqualsToken?node.right:undefined);}else if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)){for(const name of bindings(node.operand))addAssignment(name);}else if(ts.isForOfStatement(node)||ts.isForInStatement(node)){const init=node.initializer;if(ts.isVariableDeclarationList(init))for(const declaration of init.declarations)for(const name of bindings(declaration.name))addAssignment(name,undefined,true);else for(const name of bindings(init))addAssignment(name,undefined,true);}}
    const constantNames=new Set([...candidate].filter(name=>assigned.get(name)===1));for(const name of single.keys())if(assigned.get(name)!==1)single.delete(name);
    const builtins=new Set(['truth','Boolean','Number','String','Array','Object','Set','Map','Math','JSON','RegExp','undefined','NaN','Infinity','BigInt','parseInt','parseFloat','isFinite','isNaN']);
    function freeNames(input:ts.Node):Set<string>{const names=new Set<string>(),bound=new Set<string>();function walk(node:ts.Node):void{
        if(ts.isTypeNode(node))return;
        if(ts.isArrowFunction(node)||ts.isFunctionExpression(node)){for(const param of node.parameters)for(const name of bindings(param.name))bound.add(name);if(node.name)bound.add(node.name.text);walk(node.body);return;}
        if(ts.isPropertyAccessExpression(node)){walk(node.expression);return;}
        if(ts.isPropertyAssignment(node)){if(ts.isComputedPropertyName(node.name))walk(node.name.expression);walk(node.initializer);return;}
        if(ts.isIdentifier(node)){names.add(node.text);return;}
        ts.forEachChild(node,walk);
    }walk(strip(input));return new Set([...names].filter(name=>!builtins.has(name)&&!constantNames.has(name)&&!bound.has(name)));}
    function constantTrue(input:ts.Node):boolean{const node=strip(input);if(freeNames(node).size){return ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken&&(constantTrue(node.left)||constantTrue(node.right));}if(ts.isIdentifier(node)&&constantNames.has(node.text))return true;const folded=literal(node);return folded===UNKNOWN||Boolean(folded);}
    const callName=(node:ts.Node):string=>ts.isCallExpression(node)?(ts.isIdentifier(node.expression)?node.expression.text:ts.isPropertyAccessExpression(node.expression)?node.expression.name.text:''):'';
    const receiver=(node:ts.Node):ts.Expression|undefined=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)?node.expression.expression:undefined;
    function nonnegative(input:ts.Node):boolean{const node=strip(input);if(ts.isPropertyAccessExpression(node)&&['length','size'].includes(node.name.text))return true;if(ts.isCallExpression(node)&&callName(node)==='max'&&node.arguments.some(arg=>{const value=literal(arg);return typeof value==='number'&&value>=0;}))return true;if(ts.isCallExpression(node)&&['count','length'].includes(callName(node)))return true;if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){const value=literal(node.right);return typeof value==='number'&&value>=0&&nonnegative(node.left);}if(ts.isCallExpression(node)&&callName(node)==='reduce'&&node.arguments.length>=2){const initial=literal(node.arguments[1]),callback=strip(node.arguments[0]);if(typeof initial==='number'&&initial>=0&&ts.isArrowFunction(callback)&&ts.isBinaryExpression(strip(callback.body))){const body=strip(callback.body) as ts.BinaryExpression;const value=literal(body.right);return body.operatorToken.kind===ts.SyntaxKind.PlusToken&&typeof value==='number'&&value>=0;}}return false;}
    function positive(input:ts.Node):boolean{const node=strip(input);if(ts.isCallExpression(node)&&callName(node)==='max'&&node.arguments.some(arg=>typeof literal(arg)==='number'&&(literal(arg) as number)>0))return true;if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){const value=literal(node.right);return typeof value==='number'&&value>0&&nonnegative(node.left);}return false;}
    const trueFunctions=new Set<string>();for(const node of all){if(ts.isFunctionDeclaration(node)&&node.name&&node.body?.statements.length===1){const statement=node.body.statements[0];if(ts.isReturnStatement(statement)&&statement.expression&&strip(statement.expression).kind===ts.SyntaxKind.TrueKeyword)trueFunctions.add(node.name.text);}if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))){const body=node.initializer.body;if(strip(body).kind===ts.SyntaxKind.TrueKeyword||(ts.isBlock(body)&&body.statements.length===1&&ts.isReturnStatement(body.statements[0])&&body.statements[0].expression?.kind===ts.SyntaxKind.TrueKeyword))trueFunctions.add(node.name.text);}}
    const comparison=new Set([ts.SyntaxKind.GreaterThanToken,ts.SyntaxKind.GreaterThanEqualsToken,ts.SyntaxKind.LessThanToken,ts.SyntaxKind.LessThanEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken]);
    const isEqual=(kind:ts.SyntaxKind)=>kind===ts.SyntaxKind.EqualsEqualsToken||kind===ts.SyntaxKind.EqualsEqualsEqualsToken;
    const isNotEqual=(kind:ts.SyntaxKind)=>kind===ts.SyntaxKind.ExclamationEqualsToken||kind===ts.SyntaxKind.ExclamationEqualsEqualsToken;
    function emptyRegex(input:ts.Node):boolean{const node=strip(input);let pattern:string|undefined,flags='';if(ts.isRegularExpressionLiteral(node)){const match=/^\/(.*)\/([a-z]*)$/s.exec(node.text);if(match){pattern=match[1];flags=match[2].replace(/[gy]/g,'');}}else if((ts.isNewExpression(node)||ts.isCallExpression(node))&&ts.isIdentifier(node.expression)&&node.expression.text==='RegExp'&&node.arguments?.length){const value=literal(node.arguments[0]);if(typeof value==='string')pattern=value;const options=node.arguments[1]?literal(node.arguments[1]):'';if(typeof options==='string')flags=options.replace(/[gy]/g,'');}if(pattern===undefined||pattern.length>1000)return false;try{return new RegExp(pattern,flags).test('');}catch{return false;}}
    function shape(input:ts.Node,depth=0):string|undefined{
        const node=strip(input);
        if(ts.isIdentifier(node)&&depth<1&&single.has(node.text)){const inner=shape(single.get(node.text)!,depth+1);if(inner)return`${inner}; stored in variable ${node.text}`;}
        if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken){const inner=strip(node.operand);if(ts.isPrefixUnaryExpression(inner)&&inner.operator===ts.SyntaxKind.ExclamationToken){const found=shape(inner.operand,depth);if(found)return'after double negation: '+found;}if(ts.isBinaryExpression(inner)&&comparison.has(inner.operatorToken.kind)){const value=literal(inner.right);if(typeof value==='number'&&nonnegative(inner.left)&&((inner.operatorToken.kind===ts.SyntaxKind.LessThanToken&&value<=0)||(inner.operatorToken.kind===ts.SyntaxKind.LessThanEqualsToken&&value<0)))return'negation of an always-false comparison (always true)';}if(ts.isCallExpression(inner)&&['includes','contains'].includes(callName(inner))){const container=callName(inner)==='contains'?inner.arguments[0]:receiver(inner);if(container&&ts.isArrayLiteralExpression(strip(container))&&(strip(container) as ts.ArrayLiteralExpression).elements.length===0)return'not in an empty literal container (always true)';}if(ts.isCallExpression(inner)&&['isArray','isinstance'].includes(callName(inner)))return'isinstance only';}
        if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken){const bare=(value:ts.Node):ts.Node=>{let current=strip(value);while(ts.isCallExpression(current)&&['Boolean','truth'].includes(callName(current))&&current.arguments[0])current=strip(current.arguments[0]);return current;};for(const[x,y]of [[node.left,node.right],[node.right,node.left]]){const negate=bare(y);if(ts.isPrefixUnaryExpression(negate)&&negate.operator===ts.SyntaxKind.ExclamationToken&&source(bare(x))===source(bare(negate.operand)))return'excluded middle P or not P (always true)';}const left=shape(node.left,depth),right=shape(node.right,depth);if(left||right)return'tautological or term: '+(left??right);}
        if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken){const left=shape(node.left,depth),right=shape(node.right,depth);if(left&&right)return[...new Set([left,right])].join('; ');}
        if(ts.isCallExpression(node)){
            const name=callName(node);let target=receiver(node),arg=node.arguments[0];
            if(name==='truth'&&arg)return shape(arg,depth);
            if(['contains','starts','ends'].includes(name)){target=node.arguments[0];arg=node.arguments[1];}
            if(name==='isDeepStrictEqual'&&node.arguments.length===2&&source(node.arguments[0])===source(node.arguments[1]))return'identical deep-equality operands (always true)';
            if(ts.isIdentifier(node.expression)&&trueFunctions.has(node.expression.text))return`call to always-true helper ${node.expression.text}() (always true)`;
            if(['isArray','isinstance'].includes(name))return'isinstance only';
            if(name==='test'&&target&&emptyRegex(target))return'regex matching even an empty string (always true)';
            if(['startsWith','endsWith','startswith','endswith','starts','ends'].includes(name)&&arg){if(literal(arg)==='')return'startswith/endswith an empty string (always true)';if(target&&source(target)===source(arg))return'startswith/endswith itself (always true)';}
            if(['includes','contains'].includes(name)&&target&&arg){if(literal(arg)==='')return'empty-string membership (always true)';if(source(target)===source(arg))return'membership in itself (always true)';const container=strip(target);if(ts.isArrayLiteralExpression(container)&&container.elements.some(element=>source(element)===source(arg)))return'membership in a literal container containing itself (always true)';if(ts.isBinaryExpression(container)&&container.operatorToken.kind===ts.SyntaxKind.PlusToken&&(source(container.left)===source(arg)||source(container.right)===source(arg)))return'membership in concatenation containing itself (always true)';if(ts.isCallExpression(container)&&callName(container)==='repeat'&&receiver(container)&&source(receiver(container)!)===source(arg))return'membership in a repetition containing itself (always true)';}
            if(name==='every'&&target&&ts.isArrayLiteralExpression(strip(target))&&(strip(target) as ts.ArrayLiteralExpression).elements.length===0)return'all over an empty population (always true)';
        }
        if(ts.isBinaryExpression(node)&&comparison.has(node.operatorToken.kind)){
            const op=node.operatorToken.kind,right=literal(node.right);
            if(typeof right==='number'&&positive(node.left)&&((op===ts.SyntaxKind.GreaterThanToken&&right<=0)||(op===ts.SyntaxKind.GreaterThanEqualsToken&&right<=1)))return'trivial floor comparison of a provably positive expression (always true)';
            if(ts.isCallExpression(strip(node.left))&&['indexOf','lastIndexOf','find','rfind'].includes(callName(strip(node.left)))&&typeof right==='number'&&((op===ts.SyntaxKind.GreaterThanEqualsToken&&right<=-1)||(op===ts.SyntaxKind.GreaterThanToken&&right<=-2)||(isNotEqual(op)&&right<=-2)))return'comparison outside the find result range (always true)';
            for(const[side,other,reversed]of [[node.left,node.right,false],[node.right,node.left,true]] as const){const value=literal(other);if(typeof value!=='number'||!nonnegative(side))continue;let operator:ts.SyntaxKind=op;if(reversed)operator=new Map([[ts.SyntaxKind.LessThanToken,ts.SyntaxKind.GreaterThanToken],[ts.SyntaxKind.GreaterThanToken,ts.SyntaxKind.LessThanToken],[ts.SyntaxKind.LessThanEqualsToken,ts.SyntaxKind.GreaterThanEqualsToken],[ts.SyntaxKind.GreaterThanEqualsToken,ts.SyntaxKind.LessThanEqualsToken]]).get(op)??op;if(isNotEqual(operator)&&value<0)return'nonnegative != negative (always true)';if(operator===ts.SyntaxKind.GreaterThanEqualsToken&&value<=0)return'nonnegative >= a nonpositive bound (always true)';if(operator===ts.SyntaxKind.GreaterThanToken&&value<0)return'nonnegative > negative (always true)';}
            if((isEqual(op)||op===ts.SyntaxKind.GreaterThanEqualsToken||op===ts.SyntaxKind.LessThanEqualsToken)&&source(node.left)===source(node.right))return'identical operands (always true)';
            if(isEqual(op)&&(ts.isTypeOfExpression(strip(node.left))||ts.isTypeOfExpression(strip(node.right))))return'isinstance only';
            if(isNotEqual(op)&&(right===null||right===undefined)){const left=strip(node.left);if(ts.isCallExpression(left)&&['exec','match'].includes(callName(left))){const target=receiver(left);if(target&&emptyRegex(target))return'is not None on an always-matching regex (always true)';if(callName(left)==='match'&&left.arguments[0]&&emptyRegex(left.arguments[0]))return'is not None on an always-matching regex (always true)';}}
        }
        if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.InstanceOfKeyword)return'isinstance only';
        return;
    }
    const aliases=new Set(['check']);for(const node of all){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isIdentifier(node.initializer)&&aliases.has(node.initializer.text))aliases.add(node.name.text);if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isIdentifier(node.left)&&ts.isIdentifier(node.right)&&aliases.has(node.right.text))aliases.add(node.left.text);}
    const bad:string[]=[];
    for(const node of all){if(!ts.isCallExpression(node))continue;const fn=strip(node.expression);if(ts.isPropertyAccessExpression(fn)&&['push','append'].includes(fn.name.text)&&node.arguments.length===1){const tuple=strip(node.arguments[0]);if(ts.isArrayLiteralExpression(tuple)&&tuple.elements.length>=2&&strip(tuple.elements[1]).kind===ts.SyntaxKind.TrueKeyword)bad.push('inserted a constant-true verdict via results.append');}
        const isCheck=ts.isIdentifier(fn)&&aliases.has(fn.text)||ts.isPropertyAccessExpression(fn)&&fn.name.text==='check'||ts.isElementAccessExpression(fn)&&literal(fn.argumentExpression)==='check';if(!isCheck)continue;
        let verdict:ts.Node|undefined=node.arguments[1],name:ts.Node|undefined=node.arguments[0];
        if(node.arguments.length===1&&ts.isObjectLiteralExpression(strip(node.arguments[0]))){const props=(strip(node.arguments[0]) as ts.ObjectLiteralExpression).properties.filter(ts.isPropertyAssignment);verdict=props.find(prop=>['ok','passed','result'].includes(ts.isIdentifier(prop.name)||ts.isStringLiteral(prop.name)?prop.name.text:''))?.initializer;name=props.find(prop=>(ts.isIdentifier(prop.name)||ts.isStringLiteral(prop.name))&&prop.name.text==='name')?.initializer;}
        if(!verdict)continue;const label=name?(ts.isStringLiteralLike(name)?name.text:source(name).slice(0,60)):'?';if(constantTrue(verdict))bad.push(`${label}(constant)`);else if(ts.isConditionalExpression(strip(verdict))&&(constantTrue((strip(verdict) as ts.ConditionalExpression).whenTrue)||constantTrue((strip(verdict) as ts.ConditionalExpression).whenFalse)))bad.push(`${label}(constant-true ternary branch)`);else{const found=shape(verdict);if(found)bad.push(`${label}(${found})`);}
    }
    return bad;
}
export function check_no_constant_assertions(check:Check,suiteFile:string):void{
    const testsDir=dirname(resolve(suiteFile)),self=fileURLToPath(import.meta.url),extensions=new Set(['.ts','.js','.mjs','.cjs']);
    const siblings=presentDir(testsDir)?sorted(readdirSync(testsDir)).filter(name=>[...extensions].some(extension=>name.endsWith(extension))&&name!==basename(suiteFile)).map(name=>join(testsDir,name)):[];
    const sources=[...new Set([suiteFile,self,...siblings])].map(name=>({name,text:readText(name)}));
    const bad=constant_assertions(sources);check('자기검사: 상수로 평가되는 판정이 없다',!bad.length,bad.join('; ').slice(0,160));
}
