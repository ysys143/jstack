#!/usr/bin/env node
/** Native lifecycle checks preserve synthetic user assets in isolated homes. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checkPackage, writeJson as write, type PackageReceipt } from './build.js';
import { environment, codexSkills, skillRows } from './host_probe.js';
import { isMain } from '../runtime/entry.js';
export function snapshot(paths: string[]): Record<string,unknown> {
  const result: Record<string,unknown> = {};
  const visit = (path: string) => { let stat;try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    if(stat.isSymbolicLink())result[path]={link:readlinkSync(path),mode:stat.mode&0o777};
    else if(stat.isDirectory())for(const name of readdirSync(path))visit(join(path,name));
    else if(stat.isFile())result[path]={sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),mode:stat.mode&0o777};
  };for(const path of paths)visit(path);return result;
}
const receipt=(root:string)=>JSON.parse(readFileSync(join(root,'package-receipt.json'),'utf8')) as PackageReceipt;
const inside=(root:string,path:string)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
export async function runHost(host:string,previous:string,packageRoot:string,root:string) {
  const folder=join(root,host);mkdirSync(folder);const home=join(folder,'home'),env=environment(home),project=join(folder,'project');mkdirSync(project);const records:unknown[]=[];
  const run=(argv:string[],options:{require?:boolean;timeout?:number;cwd?:string}={})=>{
    const out=spawnSync(argv[0],argv.slice(1),{cwd:options.cwd??project,env,encoding:'utf8',timeout:options.timeout??50_000,maxBuffer:16*1024*1024});
    records.push({argv,rc:out.status,stdout:out.stdout,stderr:out.stderr});write(join(folder,'commands.json'),records);
    if(options.require!==false&&out.status!==0)throw new Error('native command failed: '+argv.slice(0,3).join(' ')+' ('+(out.error?.message??out.status)+')');return out;
  };
  const version=run([host,'--version']).stdout.trim(),market=join(folder,'market'),marketplace='jstack-lifecycle',oldReceipt=receipt(previous),newReceipt=receipt(packageRoot);
  if(oldReceipt.version===newReceipt.version)throw new Error('lifecycle needs distinct package versions');
  cpSync(previous,join(market,'plugins/jstack'),{recursive:true});const unrelated=join(market,'plugins/unrelated');
  for(const namespace of ['.claude-plugin','.codex-plugin'])write(join(unrelated,namespace,'plugin.json'),{name:'unrelated',version:'0.0.1',description:'Independent preservation fixture',...(namespace==='.codex-plugin'?{skills:'./skills'}:{})});
  mkdirSync(join(unrelated,'skills/unrelated-fixture'),{recursive:true});writeFileSync(join(unrelated,'skills/unrelated-fixture/SKILL.md'),'---\nname: unrelated-fixture\ndescription: Independent fixture request only.\n---\nReturn the unrelated fixture marker.\n');
  write(join(market,'.claude-plugin/marketplace.json'),{name:marketplace,owner:{name:'jstack'},plugins:['jstack','unrelated'].map(name=>({name,source:'./plugins/'+name}))});
  write(join(market,'.agents/plugins/marketplace.json'),{name:marketplace,interface:{displayName:'jstack lifecycle'},plugins:['jstack','unrelated'].map(name=>({name,source:{source:'local',path:'./plugins/'+name},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}))});
  const runtime=join(packageRoot,'payload/runtime');run(['git','init','-q']);
  for(const name of ['AGENTS.md','CLAUDE.md'])writeFileSync(join(project,name),'Existing project instruction fixture. Preserve this text.\n');writeFileSync(join(home,'.claude/CLAUDE.md'),'Existing global instruction fixture. Preserve this text.\n');
  for(const scope of ['project','global']){const name='fixture-'+scope,source=join(folder,'source-'+scope);mkdirSync(source);writeFileSync(join(source,'SKILL.md'),`---\nname: ${name}\ndescription: Run only for the explicit ${name} request.\n---\nReturn ${name}-marker.\n`);run([process.execPath,join(runtime,'skill_store.js'),'place','--scope',scope,'--name',name,'--project',project,'--source',source]);}
  const config=join(home,'.config/gws-fixture');mkdirSync(config,{recursive:true});const workspace=join(folder,'workspace.json'),reporting=join(folder,'reporting.json');
  write(workspace,{schemaVersion:1,configDir:config,account:'fixture-account'});write(reporting,{schemaVersion:1,subjectName:'Example User',mailTo:'recipient@example.invalid'});chmodSync(workspace,0o600);chmodSync(reporting,0o600);
  run([process.execPath,join(runtime,'profiles.js'),'save','work','--workspace',workspace,'--reporting',reporting,'--expected-revision','0','--default']);
  const profile=JSON.parse(run([process.execPath,join(runtime,'profiles.js'),'load']).stdout);
  const protectedPaths=[join(home,'.jstack'),join(home,'.agents/skills'),join(home,'.claude/skills'),join(home,'.claude/CLAUDE.md'),...['AGENTS.md','CLAUDE.md','.agents/skills','.claude/skills','.git/info/exclude','.git/jstack-skill-store.json'].map(path=>join(project,path))],preserved=snapshot(protectedPaths);
  run([host,'plugin','marketplace','add',market]);const add=host==='claude'?'install':'add',remove=host==='claude'?'uninstall':'remove';run([host,'plugin',add,'unrelated@'+marketplace]);
  const listing=()=>{const data=JSON.parse(run([host,'plugin','list','--json']).stdout);return (Array.isArray(data)?data:data.installed) as any[];};const identity=(row:any)=>row.id??row.pluginId;
  const unrelatedBefore=listing().find(row=>identity(row)==='unrelated@'+marketplace);if(!unrelatedBefore)throw new Error('independent fixture not installed');
  const unrelatedPaths=[join(home,`.${host}/plugins/cache`,marketplace,'unrelated')],unrelatedFiles=snapshot(unrelatedPaths),checkpoints:unknown[]=[];
  const assertUserAssets=(label:string)=>{if(!isDeepStrictEqual(snapshot(protectedPaths),preserved))throw new Error(label+': user profile, skill, link, exclude, or instruction changed');const other=listing().find(row=>identity(row)==='unrelated@'+marketplace);if(!other?.enabled||other.version!==unrelatedBefore.version||!isDeepStrictEqual(snapshot(unrelatedPaths),unrelatedFiles))throw new Error(label+': independent plugin changed');checkpoints.push({stage:label,userAssetsPreserved:true,unrelatedPluginPreserved:true});};
  const installed=async(expected:PackageReceipt)=>{
    const row=listing().find(row=>identity(row)==='jstack@'+marketplace);if(!row?.enabled||row.version!==expected.version)throw new Error('active plugin version/enabled state differs');
    const base=realpathSync(host==='claude'?row.installPath:join(home,'.codex/plugins/cache',marketplace,'jstack',expected.version));
    for(const file of expected.files){const path=join(base,file.path);if(!existsSync(path)||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw new Error('active installed bytes differ: '+file.path);}
    const loaded=JSON.parse(run([process.execPath,join(base,'payload/runtime/profiles.js'),'load']).stdout);if(!isDeepStrictEqual(loaded,profile))throw new Error('installed runtime loaded a different profile');
    if(host==='codex'){const messages=await codexSkills(project,env);write(join(folder,'discovery-'+expected.version+'.json'),messages);const rows=skillRows(messages),own=rows.filter(row=>row.name.startsWith('jstack:'));
      if(!isDeepStrictEqual(own.map(row=>row.name).sort(),expected.publicSkills.map(name=>'jstack:'+name)))throw new Error('updated Codex public skill population differs');
      if(own.some(row=>!inside(base,realpathSync(row.path))))throw new Error('Codex discovery still points to an old cache');for(const name of ['fixture-project','fixture-global'])if(rows.filter(row=>row.name===name).length!==1)throw new Error('user skill is missing or duplicated: '+name);
    }else if(!run([host,'plugin','details','jstack@'+marketplace]).stdout.split('\n')[0].includes(expected.version))throw new Error('Claude detail uses a different version');return base;
  };
  run([host,'plugin',add,'jstack@'+marketplace]);const oldCache=await installed(oldReceipt);assertUserAssets('install');
  rmSync(join(market,'plugins/jstack'),{recursive:true});cpSync(packageRoot,join(market,'plugins/jstack'),{recursive:true});run([host,'plugin',host==='claude'?'update':'add','jstack@'+marketplace]);const active=await installed(newReceipt);
  const newPaths=new Set(newReceipt.files.map(row=>row.path)),removed=oldReceipt.files.map(row=>row.path).filter(path=>!newPaths.has(path));if(!removed.length)throw new Error('previous control package has no obsolete asset to test');if(removed.some(path=>existsSync(join(active,path))))throw new Error('obsolete asset leaked into the active updated package');assertUserAssets('update');
  const original=join(market,'plugins/jstack'),hidden=join(folder,'hidden-source');renameSync(original,hidden);try{const loaded=JSON.parse(run([process.execPath,join(active,'payload/runtime/profiles.js'),'load']).stdout);if(!isDeepStrictEqual(loaded,profile))throw new Error('source-independent profile load differs');}finally{renameSync(hidden,original);}
  run([host,'plugin',remove,'jstack@'+marketplace]);if(listing().some(row=>identity(row)==='jstack@'+marketplace))throw new Error('removed plugin remains installed');if(host==='codex'&&skillRows(await codexSkills(project,env)).some(row=>row.name.startsWith('jstack:')))throw new Error('removed Codex plugin remains discoverable');assertUserAssets('remove');
  run([host,'plugin',add,'jstack@'+marketplace]);await installed(newReceipt);
  if(host==='claude'){
    const startup=run([host,'--print','--output-format','stream-json','--verbose','--no-session-persistence','--max-turns','1','--permission-mode','plan','Return the discovery fixture marker without tools.'],{require:false,timeout:60_000});
    const events=startup.stdout.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}),init=events.find(event=>event.type==='system'&&event.subtype==='init');if(!init)throw new Error('Claude startup did not expose native skill discovery');const names:string[]=init.skills??[];
    for(const name of ['fixture-project','fixture-global'])if(names.filter(value=>value===name).length!==1)throw new Error('Claude user skill missing or duplicated: '+name);if(!isDeepStrictEqual(names.filter(name=>name.startsWith('jstack:')).sort(),newReceipt.publicSkills.map(name=>'jstack:'+name)))throw new Error('Claude startup plugin skill population differs');write(join(folder,'native-startup.json'),events);
  }
  assertUserAssets('reinstall');return{host,version,passed:true,checkpoints,profileReadFromInstalledRuntime:true,sourceIndependentRead:true,obsoleteActiveFilesAbsent:removed.sort(),oldCacheRetained:existsSync(oldCache),userSkillsNativeDiscovery:true,modelInferenceAttempted:host==='claude',modelInferenceTested:false};
}
export async function main(argv=process.argv.slice(2)):Promise<number>{
  const args=new Map<string,string>();for(let i=0;i<argv.length;i+=2){if(argv[i]==='--help'){console.log('lifecycle_probe.js --previous DIRECTORY --package DIRECTORY [--output DIRECTORY]');return 0;}if(!['--previous','--package','--output'].includes(argv[i])||!argv[i+1])throw new Error('Invalid lifecycle arguments');args.set(argv[i],argv[i+1]);}
  if(!args.has('--previous')||!args.has('--package'))throw new Error('--previous and --package are required');const previous=resolve(args.get('--previous')!),current=resolve(args.get('--package')!);checkPackage(previous);checkPackage(current);
  const root=args.has('--output')?resolve(args.get('--output')!):mkdtempSync(join(tmpdir(),'jstack-lifecycle-'));if(args.has('--output'))mkdirSync(root);console.log('Lifecycle evidence:',root);const results:any[]=[];
  for(const host of ['claude','codex']){let row;try{row=await runHost(host,previous,current,root);}catch(error){row={host,passed:false,error:String(error)};}results.push(row);write(join(root,'summary.json'),{previous:receipt(previous).sourceSha256,package:receipt(current).sourceSha256,hosts:results});console.log(JSON.stringify(row));}return results.every(row=>row.passed)?0:1;
}
if(isMain(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(String(error));process.exitCode=2;});
