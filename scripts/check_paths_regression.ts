import { isMain } from '../runtime/entry.js';
/** Reject new unresolved references, missing measurements and checker crashes. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runProcess} from '../runtime/os.js';
import {sourceRoot} from './doctor-work.js';
export const CEILING=0;
export function parseMiss(text:string):Set<string>{const out=new Set<string>();let ref:string|undefined;for(const line of text.split(/\r?\n/)){const match=/^  (?!  )(\S.*)$/.exec(line);if(match&&!line.startsWith('    ')){ref=match[1]!.trim();continue;}const source=/^    <- (.+)$/.exec(line);if(source&&ref){out.add(JSON.stringify([ref,source[1]!.trim()]));ref=undefined;}}return out;}
export function baselineByTree(file:string):Record<string,Set<string>>|undefined{if(!fs.existsSync(file))return undefined;const out:Record<string,Set<string>>={};let current:string|undefined,buffer:string[]=[];for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const match=/^## (\S+)/.exec(line);if(match){if(current)out[current]=parseMiss(buffer.join('\n'));current=match[1];buffer=[];}else buffer.push(line);}if(current)out[current]=parseMiss(buffer.join('\n'));return out;}
export interface CheckerOutput {status:number|null;stdout:string;stderr:string;error?:Error}
export function checkPathsRegression(options:{root?:string;runtime?:string;checker?:string;run?:(command:string,args:string[],cwd:string)=>CheckerOutput}={}){
  const root=options.root??sourceRoot(),runtime=options.runtime??process.env.JSTACK_RUNTIME_ROOT??root,checker=options.checker??fileURLToPath(new URL('./check_plugin_paths.js',import.meta.url));
  const baseline=path.join(root,'tests/fixtures/path-reference-baseline.txt'),base=baselineByTree(baseline),lines:string[]=[];
  const failed=(text:string)=>({code:2,lines:[`[2] ${text}`],newTotal:0});
  if(!base)return failed(`baseline missing: ${baseline}`);if(!fs.existsSync(checker)||!fs.statSync(checker).isFile())return failed(`checker missing: ${checker}`);if(!fs.existsSync(runtime)||!fs.statSync(runtime).isDirectory())return failed(`runtime root missing: ${runtime}`);
  const runner=options.run??((command,args,cwd)=>runProcess(command,args,{cwd,timeout:120000}));const result=runner(process.execPath,[checker,runtime,root],root);
  if(result.error||![0,1].includes(result.status??-1)||/Traceback \(most recent call last\)|(?:^|\n)(?:Error|TypeError|ReferenceError|SyntaxError):/.test(result.stderr))return failed(`jstack: checker crashed (rc=${result.status}) ${result.stderr.trim().split('\n').slice(-3).join('\n')}`);
  if(!result.stdout.trim())return failed('jstack: checker emitted no measurement');const summary=/^참조 (\d+)건 \/ 실재 \d+건 \/ MISS \d+건/m.exec(result.stdout);
  if(!summary||Number(summary[1])===0||result.stdout.includes('위생 위반 '))return failed('jstack: missing measurement or repository hygiene failure');
  const current=parseMiss(result.stdout);if(result.status===1&&!current.size)return failed('jstack: checker failed without parsed reference diagnostics');
  const old=base.jstack??new Set<string>(),added=[...current].filter(item=>!old.has(item)).sort(),gone=[...old].filter(item=>!current.has(item));
  lines.push(`jstack: MISS ${current.size} (baseline ${old.size}); new ${added.length}; resolved ${gone.length}`,...added.map(item=>{const[ref,src]=JSON.parse(item);return `  [new] ${ref}\n           <- ${src}`;}),`New MISS ${added.length}; ceiling ${CEILING}`);
  return {code:added.length>CEILING?1:0,lines,newTotal:added.length};
}
if(isMain(import.meta.url)){const result=checkPathsRegression({root:process.argv[2]?path.resolve(process.argv[2]):undefined});console.log(result.lines.join('\n'));process.exitCode=result.code;}
