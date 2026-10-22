import { isMain } from '../runtime/entry.js';
/** Measure the actual outer distribution; retain the approved fixed budget. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
export const BUDGET = {jstack: {always_on_tokens: 7566, dist_bytes: 83886080, why: '2026-09-10: user-approved size increase for the Node runtime and offline native assets. Fixed 80 MiB ceiling; resident-description token ceiling unchanged.'}};
export function toks(text: string): number {const chars = [...text]; const korean = chars.filter(c => c >= '가' && c <= '힣').length; return korean + Math.floor((chars.length - korean + 3)/4);}
export type Description = [string,string,number];
const isDir = (p: string) => {try {return fs.statSync(p).isDirectory();} catch {return false;}};
const isFile = (p: string) => {try {return fs.statSync(p).isFile();} catch {return false;}};
const names = (dir: string) => isDir(dir) ? fs.readdirSync(dir).filter(name => !name.startsWith('.')).sort() : [];
export function descriptions(root: string): Description[] {
  const parts: Description[] = [];
  for (const [kind, dir] of [['skill','skills'],['command','commands'],['agent','agents']]) {
    const base = path.join(root, dir!); const files = names(base).map(name => kind === 'skill' ? path.join(base,name,'SKILL.md') : path.join(base,name)).filter(file => isFile(file) && file.endsWith('.md'));
    for (const file of files) {
      let text: string; try {text = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/\r/g,'\n');} catch {continue;}
      const front = /^---\n(.*?)\n---/s.exec(text); if (!front) continue;
      const description = /^description:\s*(.*?)(?=\n[a-z][a-z-]*:|(?![\s\S]))/ms.exec(front[1]!);
      if (description) parts.push([kind!,kind === 'skill' ? path.basename(path.dirname(file)) : path.basename(file,'.md'),toks(description[1]!.trim())]);
    }
  }
  try {const manifest = JSON.parse(fs.readFileSync(path.join(root,'.claude-plugin/plugin.json'),'utf8')); if (manifest.description) parts.push(['manifest',manifest.name ?? '?',toks(manifest.description)]);} catch {}
  return parts;
}
export function distBytes(root: string): number {
  let total = 0; const skip = new Set(['__pycache__','.pytest_cache','node_modules']);
  const visit = (dir: string) => {for (const item of fs.readdirSync(dir,{withFileTypes:true})) {if (item.isDirectory()) {if (!skip.has(item.name)) visit(path.join(dir,item.name));} else {try {const stat = fs.statSync(path.join(dir,item.name)); if (!stat.isDirectory()) total += stat.size;} catch {}}}};
  visit(root); return total;
}
export function checkCost(packageRoot: string) {
  const root = fs.realpathSync(packageRoot); if (!isDir(root)) throw new Error(`package tree missing: ${root}`);
  const base = descriptions(path.join(root,'payload')); const hosts = ['claude','codex'].map(host => {
    const parts: Description[] = []; const entries = path.join(root,'entries',host);
    const visit = (dir: string) => { for (const name of names(dir)) {
      const child = path.join(dir, name);
      if (isDir(child)) visit(child);
      else if (name === 'SKILL.md') {
        const front = /^---\n(.*?)\n---/s.exec(fs.readFileSync(child,'utf8').replace(/\r\n/g,'\n'));
        const match = front && /^description:\s*(.*?)(?=\n[a-z][a-z-]*:|(?![\s\S]))/ms.exec(front[1]!);
        if (match) parts.push(['skill',path.basename(dir),toks(match[1]!.trim())]);
      }
    } };
    visit(entries);
    parts.push(...base.filter(p => p[0] === 'manifest' || host === 'claude' && ['command','agent'].includes(p[0]))); return parts;
  });
  const sum = (parts: Description[]) => parts.reduce((n,p) => n+p[2],0);
  const parts = sum(hosts[0]!) >= sum(hosts[1]!) ? hosts[0]! : hosts[1]!;
  const out = {jstack: {always_on_tokens:sum(parts),dist_bytes:distBytes(root),budget:BUDGET.jstack,top:[...parts].sort((a,b)=>b[2]-a[2]).slice(0,5)}};
  const bad = Number(out.jstack.always_on_tokens > BUDGET.jstack.always_on_tokens) + Number(out.jstack.dist_bytes > BUDGET.jstack.dist_bytes);
  return {code:bad ? 1 : 0,out,bad,count:parts.length};
}
export function main(argv: string[]): number {
  let root = process.env.JSTACK_PACKAGE_ROOT; let json = false;
  for (let i=0;i<argv.length;i++) {if (argv[i] === '--json') json=true; else if (argv[i] === '--package' && argv[i+1]) root=argv[++i]; else {console.error('[2] usage: check_cost --package PATH [--json]');return 2;}}
  if (!root) {console.error('[2] --package or JSTACK_PACKAGE_ROOT must identify the actual distribution');return 2;}
  try {const result=checkCost(root); if (json) console.log(JSON.stringify(result.out,null,1)); else {for (const key of ['always_on_tokens','dist_bytes'] as const) console.log(`[${result.out.jstack[key] <= BUDGET.jstack[key] ? 'OK':'FAIL'}] ${key}: ${result.out.jstack[key]} / ${BUDGET.jstack[key]}`); console.log(`Descriptions: ${result.count}; budget violations: ${result.bad}; token estimate is not a host observation`);}return result.code;} catch(error) {console.error(`[2] ${(error as Error).message}`);return 2;}
}
if (isMain(import.meta.url)) process.exitCode=main(process.argv.slice(2));
