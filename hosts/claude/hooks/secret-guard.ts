/** jstack secret-output guardrail. Never serializes file bytes or tool arguments. */
import {existsSync,lstatSync,readdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {isMain} from '../../../runtime/entry.js';

export interface SecretInput { tool_name?: string; cwd?: string; tool_input?: {file_path?: string; path?: string; command?: string}; }
export interface SecretDecision {hookSpecificOutput:{hookEventName:'PreToolUse';permissionDecision:'deny';permissionDecisionReason:string}}
const policy='jstack-SECRET-OUTPUT/v1';
function deny(error=false):SecretDecision { return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:
  `${policy}: ${error?'Guard inspection failed; the candidate output operation remains blocked.':'This operation can expose a protected environment file.'} No file contents or tool arguments are included in this message. Exceptions are unsupported: no agent-inaccessible approval/consume anchor is configured. A command marker, project approval file or prior assistant claim cannot grant an exception. Use a secret-free template or a narrower nonsecret path; normal application credential use need not print credentials. This hook is an unregistered jstack candidate and gives no protection guarantee; if a host runs it, inspect hook trust and runtime availability before retrying. Do not disable all hooks or retry unchanged.`}}; }
const protectedName=(name:string)=>name==='.env'||name.startsWith('.env.');
function emptyTemplate(path:string):boolean {
  if(!/^\.env\.(?:example|sample|template)$/.test(basename(path)))return false;
  if(statSync(path).size>65536)return false;
  // Only comments, blank lines and empty assignments are provably secret-free.
  return readFileSync(path,'utf8').split(/\r?\n/).every(line=>!line.trim()||line.trimStart().startsWith('#')||/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:""|'')?\s*$/.test(line));
}
function sensitive(path:string, seen=new Set<string>(), budget={left:10000}):boolean {
  if(--budget.left<0)throw new Error('inspection limit');
  if(!existsSync(path)){if(lstatMissingLink(path))throw new Error('unresolved link');return protectedName(basename(path));}
  const real=realpathSync(path);if(seen.has(real))return false;seen.add(real);
  const stat=statSync(real);
  if(protectedName(basename(path))||protectedName(basename(real)))return !emptyTemplate(real);
  if(stat.isDirectory())return readdirSync(real).some(name=>sensitive(join(real,name),seen,budget));
  // A neutral hard-link in the same directory must not bypass a protected name.
  if(stat.nlink>1)for(const name of readdirSync(dirname(real)).filter(protectedName)){
    const other=join(dirname(real),name);if(!existsSync(other))continue;const candidate=statSync(other);
    if(candidate.dev===stat.dev&&candidate.ino===stat.ino&&!emptyTemplate(other))return true;
  }
  return false;
}
function lstatMissingLink(path:string):boolean {try{return lstatSync(path).isSymbolicLink();}catch{return false;}}
const readers=/\b(?:cat|head|tail|grep|rg|sed|awk|less|more|strings|bat|base64|xxd|od|hexdump|jq|yq)\b/;
export function inspectSecretOutput(input:SecretInput):SecretDecision|undefined {
  try {
    if(!input||typeof input!=='object'||typeof input.tool_name!=='string'||!input.tool_input||typeof input.tool_input!=='object')return deny(true);
    const cwd=input.cwd??process.cwd();if(!isAbsolute(cwd))return deny(true);
    const value=input.tool_input;
    if(input.tool_name==='Read')return typeof value.file_path==='string'?(sensitive(resolve(cwd,value.file_path))?deny():undefined):deny(true);
    if(input.tool_name==='Grep')return sensitive(resolve(cwd,value.path??'.'))?deny():undefined;
    if(!['Bash','exec_command','shell','shell_command'].includes(input.tool_name))return undefined;
    if(typeof value.command!=='string')return deny(true);
    const command=value.command;
    // Includes interpreter literals, redirections and self-authorized markers.
    if(/(^|[^A-Za-z0-9_])\.env(?:\b|\.)/.test(command))return deny();
    if(!readers.test(command))return undefined;
    const words=command.match(/"[^"\n]*"|'[^'\n]*'|[^\s;|&<>]+/g)??[];
    let inspected=false;
    for(const token of words){
      const word=token.replace(/^['"]|['"]$/g,'');
      if(!word||word.startsWith('-')||readers.test(word))continue;
      if(/[$`*?{}]/.test(word)){if(sensitive(cwd))return deny();continue;}
      const path=resolve(cwd,word);if(existsSync(path)){inspected=true;if(sensitive(path))return deny();}
    }
    if(!inspected&&/\b(?:grep|rg)\b/.test(command)&&sensitive(cwd))return deny();
    return undefined;
  } catch {return deny(true);}
}
if(isMain(import.meta.url)){
  let result:SecretDecision|undefined;
  try{const raw=readFileSync(0,'utf8');result=raw.length>1024*1024?deny(true):inspectSecretOutput(JSON.parse(raw));}
  catch{result=deny(true);}
  if(result)process.stdout.write(JSON.stringify(result)+'\n');
}
