#!/usr/bin/env node
/** Native discovery probes use disposable homes without copied credentials. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checkPackage, writeJson, type PackageReceipt } from './build.js';
import { isMain } from '../runtime/entry.js';
import { skillExports } from '../runtime/skill_catalog.js';
export const write = writeJson;
export function environment(home: string): NodeJS.ProcessEnv {
  mkdirSync(join(home, '.codex'), { recursive: true }); mkdirSync(join(home, '.claude'), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_STATE_HOME: join(home, '.state') };
  for (const key of Object.keys(env)) if (['API_KEY','AUTH_TOKEN','OAUTH_TOKEN'].some(token => key.includes(token)) || key === 'CLAUDECODE') delete (env as NodeJS.ProcessEnv)[key];
  return env;
}
function appServerRequest(cwd: string, env: NodeJS.ProcessEnv, method: string): Promise<any[]> {
  return new Promise((accept, reject) => {
    const child = spawn('codex', ['app-server'], { cwd, env, stdio: ['pipe','pipe','pipe'] });
    const messages: any[] = []; let buffer = '', settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); const kill = setTimeout(() => child.kill('SIGKILL'), 3000); kill.unref(); child.once('close', () => clearTimeout(kill)); error ? reject(error) : accept(messages); };
    const timer = setTimeout(() => finish(new Error(`${method} response timed out`)), 45_000);
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
    child.on('error', error => finish(error)); child.stdin.on('error', error => finish(error));
    child.on('exit', () => finish(new Error('app-server terminated before skills/list')));
    child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      buffer += data; if (buffer.length > 16 * 1024 * 1024) return finish(new Error('app-server response exceeds limit'));
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n'), line = buffer.slice(0,index); buffer = buffer.slice(index+1); if (!line) continue;
        try {
          const message = JSON.parse(line); messages.push(message);
          if (message.id === 1) { if (message.error) throw new Error('app-server initialization failed'); send({ method: 'initialized' }); send({ id: 2, method, params: { cwds: [cwd], ...(method === 'skills/list' ? { forceReload: true } : {}) } }); }
          if (message.id === 2) { if (message.error) throw new Error(`${method} failed`); finish(); }
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'jstack-host-probe', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
  });
}
export const codexSkills = (cwd: string, env: NodeJS.ProcessEnv): Promise<any[]> => appServerRequest(cwd, env, 'skills/list');
/** Read-only native hook discovery; a fresh isolated home must remain untrusted. */
export const codexHooks = (cwd: string, env: NodeJS.ProcessEnv): Promise<any[]> => appServerRequest(cwd, env, 'hooks/list');
export function skillRows(messages: any[]): any[] {
  const result = messages.find(message => message.id === 2)?.result; if (!result) throw new Error('skills/list result is missing');
  const rows: any[] = [];
  const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (typeof value.name === 'string' && typeof value.path === 'string') rows.push(value); for (const child of Object.values(value)) visit(child); };
  visit(result); return rows;
}
function files(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root,entry.name)) : [join(root,entry.name)]); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const inside = (root: string, target: string) => { const rel = relative(root,target); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
export async function probe(packageRoot: string, root: string, hosts: string[], privateValues: string[] = []): Promise<boolean> {
  packageRoot = realpathSync(packageRoot); checkPackage(packageRoot,privateValues);
  const receipt = JSON.parse(readFileSync(join(packageRoot,'package-receipt.json'),'utf8')) as PackageReceipt, names = receipt.publicSkills;
  const exports = skillExports(join(packageRoot, 'payload'));
  const market = join(root,'market'), marketplace = 'jstack-repack-test';
  cpSync(packageRoot,join(market,'plugins/jstack'),{ recursive:true });
  write(join(market,'.claude-plugin/marketplace.json'),{ name:marketplace,owner:{name:'jstack'},plugins:[{name:'jstack',source:'./plugins/jstack'}] });
  write(join(market,'.agents/plugins/marketplace.json'),{name:marketplace,interface:{displayName:'jstack test'},plugins:[{name:'jstack',source:{source:'local',path:'./plugins/jstack'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]});
  const results: any[] = [];
  for (const host of hosts) {
    const folder = join(root,host), home = join(folder,'home'), env = environment(home), commands: unknown[] = [], row: any = {host,modelInferenceTested:false};
    const run = (argv: string[]) => {
      const out = spawnSync(argv[0],argv.slice(1),{cwd:folder,env,encoding:'utf8',timeout:50_000,maxBuffer:16*1024*1024});
      commands.push({argv,rc:out.status,stdout:out.stdout,stderr:out.stderr}); write(join(folder,'commands.json'),commands);
      if (out.status !== 0) throw new Error(`${host} command failed: ${argv.slice(0,3).join(' ')} (${out.error?.message ?? out.status})`);
      return out.stdout;
    };
    try {
      row.version = run([host,'--version']).trim();
      run([host,'plugin','marketplace','add',market]); run([host,'plugin',host === 'claude' ? 'install' : 'add',`jstack@${marketplace}`]); run([host,'plugin','list']);
      const entries = files(join(home,`.${host}/plugins/cache`)).filter(path => path.endsWith('/SKILL.md') && path.includes(`/entries/${host}/`)).sort();
      if (entries.length !== names.length || !same(entries.map(path => dirname(path).split(sep).at(-1)).sort(),names)) throw new Error('cached public names differ');
      const roots = new Set(entries.map(path => {
        const entry = exports.find(entry => path.endsWith(`/entries/${host}/${entry.path}/SKILL.md`));
        if (!entry) throw new Error('Cached skill has an undeclared hierarchy');
        return realpathSync(resolve(dirname(path), ...Array(2 + entry.path.split('/').length).fill('..')));
      })); if (roots.size !== 1) throw new Error('multiple active cache roots');
      const installed = [...roots][0];
      if (host === 'claude') {
        const detail = run([host,'plugin','details',`jstack@${marketplace}`]);
        const check = (label: string, expected: string[]) => {
          const match = new RegExp(`^\\s*${label} \\((\\d+)\\)\\s+(.+?)(?:\\s{2,}\\(|$)`,'m').exec(detail);
          if (!match || Number(match[1]) !== expected.length || !same(match[2].split(',').map(x=>x.trim()).sort(),expected.sort())) throw new Error(`Claude native ${label} inventory differs`);
          return expected.length;
        };
        row.nativeDiscoveryCount = check('Skills',[...names,...readdirSync(join(packageRoot,'hosts/claude/commands')).filter(x=>x.endsWith('.md')).map(x=>x.slice(0,-3))]);
        row.nativeAgents = check('Agents',readdirSync(join(packageRoot,'agents')).filter(x=>x.endsWith('.md')).map(x=>x.slice(0,-3)));
        row.nativeHookEvents = check('Hooks',Object.keys(JSON.parse(readFileSync(join(packageRoot,'hooks/hooks.json'),'utf8')).hooks));
      } else {
        const messages = await codexSkills(folder,env); write(join(folder,'discovery.json'),messages);
        const found = skillRows(messages).filter(row=>row.name.startsWith('jstack:'));
        if (!same(found.map(row=>row.name).sort(),names.map(name=>'jstack:'+name)) || found.some(row=>!inside(installed,realpathSync(row.path)))) throw new Error('Codex native skills/list differs from declared names or installation');
        row.nativeDiscoveryCount = found.length;
        const hookMessages = await codexHooks(folder,env); write(join(folder,'hooks-discovery.json'),hookMessages);
        const hookData = hookMessages.find(message=>message.id===2)?.result?.data;
        const ownHooks = Array.isArray(hookData) ? hookData.flatMap((entry:any)=>entry.hooks??[]).filter((entry:any)=>entry.pluginId===`jstack@${marketplace}`) : [];
        // An explicit Codex manifest hook list replaces default hooks/hooks.json discovery.
        const hookFiles: string[] = (JSON.parse(readFileSync(join(packageRoot,'.codex-plugin','plugin.json'),'utf8')).hooks ?? ['./hooks/hooks.json']).map((path:string)=>path.replace(/^\.\//,''));
        const eventKey = (event:string) => event.replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase();
        const expectedEvents = hookFiles.flatMap(file=>Object.entries(JSON.parse(readFileSync(join(packageRoot,file),'utf8')).hooks).flatMap(([event, entries])=>(entries as any[]).flatMap((entry:any)=>entry.hooks.map(()=>eventKey(event))))).sort();
        const observedEvents = ownHooks.map((hook:any)=>eventKey(hook.eventName)).sort();
        const declaredSources = hookFiles.map(file=>realpathSync(join(installed,file)));
        if (!same(observedEvents,expectedEvents) || ownHooks.some((hook:any)=>!hook.enabled || hook.source!=='plugin' || hook.trustStatus!=='untrusted' || !declaredSources.includes(realpathSync(hook.sourcePath))))
          throw new Error('Codex bundled hooks are missing, not enabled, not installed from this package, or unexpectedly trusted');
        row.nativeHookEvents = ownHooks.length;
        row.untrustedHookCount = ownHooks.length;
      }
      for (const file of receipt.files) {
        const path = join(installed,file.path);
        if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256) throw new Error('installed asset differs: '+file.path);
        if (receipt.schemaVersion === 1 && file.mode !== undefined && (statSync(path).mode & 0o777) !== file.mode) throw new Error('installed file mode differs: '+file.path);
      }
      row.byteMatchedFiles = receipt.files.length; row.installedPackageCheck = checkPackage(installed,privateValues);
      const original = join(market,'plugins/jstack'), hidden = join(root,'source-hidden'); renameSync(original,hidden);
      try {
        const markers = entries.map(entry => {
          const marker = JSON.parse(run([process.execPath,join(dirname(entry),'scripts/inspect-root.mjs')]));
          if (!marker.runtimePresent || !marker.sourcePresent || realpathSync(marker.root) !== installed || !inside(installed,marker.canonical)) throw new Error('entry dependency missing or resolves outside installed cache');
          return marker;
        });
        const inspected = JSON.parse(run([process.execPath,join(installed,'payload/runtime/profiles.js'),'inspect']));
        if (!same(inspected,{configured:false,profiles:[]}) || existsSync(join(home,'.jstack'))) throw new Error('read-only inspection wrote user state');
        row.executedEntries = markers.length; write(join(folder,'execution.json'),markers);
      } finally { renameSync(hidden,original); }
      row.passed = true;
    } catch (error) { row.passed = false; row.error = String(error); }
    results.push(row); write(join(root,'summary.json'),{packageSourceSha256:receipt.sourceSha256,hosts:results}); console.log(JSON.stringify(row));
  }
  return results.every(row=>row.passed);
}
export async function main(argv=process.argv.slice(2)): Promise<number> {
  const args = new Map<string,string>();
  for(let i=0;i<argv.length;i+=2) { if(argv[i]==='--help'){console.log('host_probe.js --package DIRECTORY [--output DIRECTORY] [--host claude|codex|both]');return 0;} if(!['--package','--output','--host','--private-values'].includes(argv[i]) || !argv[i+1]) throw new Error('Invalid probe arguments'); args.set(argv[i],argv[i+1]); }
  if(!args.has('--package')) throw new Error('--package is required'); const host=args.get('--host')??'both'; if(!['both','claude','codex'].includes(host)) throw new Error('Invalid host');
  const root=args.has('--output')?resolve(args.get('--output')!):mkdtempSync(join(tmpdir(),'jstack-host-probe-')); if(args.has('--output'))mkdirSync(root,{recursive:false});
  const values=args.has('--private-values')?JSON.parse(readFileSync(args.get('--private-values')!,'utf8')):[]; if(!Array.isArray(values)||values.some(x=>typeof x!=='string'))throw new Error('private comparison must be a list of strings');
  console.log('Evidence:',root); return await probe(resolve(args.get('--package')!),root,host==='both'?['claude','codex']:[host],values)?0:1;
}
if(isMain(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(String(error));process.exitCode=2;});
