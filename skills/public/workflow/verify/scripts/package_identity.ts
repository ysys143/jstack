import { isMain } from '../../../../../runtime/entry.js';
/** Deterministic package identity. Concept adapted from Skillstead 84a5343; no upstream source copied. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {expand} from '../../../../../runtime/os.js';
import {parseDocument,pyRepr} from '../../../../../scripts/content_contract.js';
export const SCHEMA='jstack.package-identity/v1',ALGORITHM='sha256/canon-v2';
export const ROLES=['runtime','test','assets','metadata'] as const;
const TRANSIENT_DIRS=new Set(['.git','.idea','.cwf','.gjc','.omc','.senpi','.venv','.jstack-artifacts','__prompts','uv-cache','__pycache__','.pytest_cache','.ruff_cache','node_modules']);
const transient=(name:string)=>name==='.DS_Store'||/\.py[co]$/.test(name);
export class IdentityError extends globalThis.Error{}
export const inside=(root:string,child:string)=>{const relative=path.relative(root,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export function codepointCompare(a:string,b:string):number{const left=[...a],right=[...b];for(let i=0;i<Math.min(left.length,right.length);i++){const difference=left[i]!.codePointAt(0)!-right[i]!.codePointAt(0)!;if(difference)return difference;}return left.length-right.length;}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest();
const utf8=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
export function canonical(value:any):Buffer{
  const encode=(item:any):string=>{
    if(typeof item==='bigint')return String(item);
    if(item&&typeof item==='object'&&item.constructor?.name==='PythonFloat')return pyRepr(item).replace(/^inf$/,'Infinity').replace(/^-inf$/,'-Infinity').replace(/^nan$/,'NaN');
    if(Array.isArray(item))return '['+item.map(encode).join(',')+']';
    if(item&&typeof item==='object')return '{'+Object.keys(item).sort(codepointCompare).map(key=>JSON.stringify(key)+':'+encode(item[key])).join(',')+'}';
    return JSON.stringify(item);
  };return Buffer.from(encode(value));
}
export function _framed_digest(entries:Iterable<[string,Buffer,number]>):Buffer{
  const chunks:Buffer[]=[];for(const[rel,data,mode]of [...entries].sort((a,b)=>codepointCompare(a[0],b[0])))chunks.push(Buffer.from(rel),Buffer.from([0]),Buffer.from(mode.toString(8).padStart(4,'0')),Buffer.from([0]),sha(data),Buffer.from([0]));return sha(Buffer.concat(chunks));
}
function directoryPayload(root:string,directory:string,seen:Set<string>):Buffer{
  const entries:[string,Buffer,number][]=[];
  const visit=(current:string)=>{for(const name of fs.readdirSync(current).sort(codepointCompare)){if(transient(name))continue;const file=path.join(current,name),rel=path.relative(directory,file).split(path.sep).join('/'),stat=fs.lstatSync(file);if(stat.isSymbolicLink())entries.push([rel,symlink_payload(root,file,seen),stat.mode&0o7777]);else if(stat.isDirectory()){if(!TRANSIENT_DIRS.has(name))visit(file);}else if(stat.isFile())entries.push([rel,fs.readFileSync(file),stat.mode&0o7777]);else throw new IdentityError(`non-regular symlink target entry: ${rel}`);}};visit(directory);return Buffer.concat([Buffer.from('directory\0'),_framed_digest(entries)]);
}
export function symlink_payload(root:string,link:string,previous:Set<string>=new Set()):Buffer{
  try{
    const base=fs.realpathSync(expand(root)),file=path.resolve(link);if(!fs.lstatSync(file).isSymbolicLink())throw new IdentityError(`not a symlink: ${file}`);
    const targetBytes=fs.readlinkSync(file,{encoding:'buffer'}),target=utf8(targetBytes);if(path.isAbsolute(target))throw new IdentityError(`absolute symlink is not allowed: ${file}`);
    let resolved:string;try{resolved=fs.realpathSync(path.resolve(path.dirname(file),target));}catch{throw new IdentityError(`symlink target is missing or not a regular path: ${file} -> ${target}`);}
    if(!inside(base,resolved))throw new IdentityError(`symlink escapes package: ${file}`);const stat=fs.statSync(resolved);if(!stat.isFile()&&!stat.isDirectory())throw new IdentityError(`symlink target is missing or not a regular path: ${file} -> ${target}`);
    if(previous.has(resolved))throw new IdentityError(`symlink target cycle: ${file}`);const seen=new Set(previous);seen.add(resolved);const bytes=stat.isDirectory()?directoryPayload(base,resolved,seen):fs.readFileSync(resolved);
    return Buffer.concat([Buffer.from('symlink\0'),targetBytes,Buffer.from([0]),bytes]);
  }catch(error){if(error instanceof IdentityError)throw error;throw new IdentityError(`cannot read symlink ${link}: ${(error as globalThis.Error).message}`);}
}
export function _iter_files(root:string):[string,string,number][]{
  const base=fs.realpathSync(root);if(!fs.statSync(base).isDirectory())throw new IdentityError(`package root is not a real directory: ${base}`);const found:[string,string,number][]=[];
  const visit=(directory:string)=>{for(const name of fs.readdirSync(directory).sort(codepointCompare)){if(transient(name))continue;const file=path.join(directory,name),rel=path.relative(base,file).split(path.sep).join('/'),stat=fs.lstatSync(file);if(stat.isSymbolicLink()){symlink_payload(base,file);found.push([rel,file,stat.mode&0o7777]);continue;}if(stat.isDirectory()){if(!TRANSIENT_DIRS.has(name))visit(file);continue;}if(!stat.isFile())throw new IdentityError(`non-regular package entry: ${rel}`);if(!inside(base,fs.realpathSync(file)))throw new IdentityError(`package path escapes root: ${rel}`);found.push([rel,file,stat.mode&0o7777]);}};visit(base);return found.sort((a,b)=>codepointCompare(a[0],b[0]));
}
export function classify_path(rel:string):typeof ROLES[number]{
  const name=rel.split('/').at(-1)!;if(rel.startsWith('tests/')||rel.includes('/tests/')||rel.startsWith('evals/')||rel.startsWith('contracts/'))return 'test';if(rel.startsWith('assets/')||rel.includes('/assets/')||rel.startsWith('examples/'))return 'assets';
  if(['CHANGELOG.md','README.md','README.ko.md','MIGRATION.md','AGENTS.md'].includes(rel)||['plugin.json','marketplace.json','host-adapter.json','LICENSE','NOTICE','UPSTREAM.sha256','package-surface.yaml'].includes(name)||/^(LICENSE|NOTICE)\./.test(name)||rel.startsWith('.claude-plugin/')||rel.startsWith('.codex-plugin/'))return 'metadata';return 'runtime';
}
export function _normalise_runtime(rel:string,data:Buffer):Buffer{
  if(!rel.endsWith('SKILL.md'))return data;let text:string;try{text=utf8(data);}catch{return data;}const match=/^(---\r?\n.*?\r?\n---\r?\n)([\s\S]*)$/s.exec(text);if(!match)return data;
  const front=match[1]!.replace(/(^metadata:\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+version:[ \t]*)[^\r\n]*/m,'$1@VERSION@');return Buffer.from(front+match[2]!);
}
export function _normalise_manifest(data:Buffer):Buffer{let manifest:any;try{manifest=parseDocument(utf8(data));}catch(error){throw new IdentityError(`manifest is not valid JSON: ${(error as globalThis.Error).message}`);}if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new IdentityError('manifest is not a JSON object');if('version'in manifest)manifest={...manifest,version:'@VERSION@'};return canonical(manifest);}
export function _digest(entries:Iterable<[string,Buffer]>,modes:Record<string,number>={}):string{return sha(_framed_digest([...entries].map(([rel,data])=>[rel,data,modes[rel]??0o644]))).toString('hex');}
const manifests=['.claude-plugin/plugin.json','.codex-plugin/plugin.json','plugin.json'];
export function compute_identity(root:string):any{
  try{
    const base=fs.realpathSync(expand(root)),raw=new Map<string,Buffer>(),modes:Record<string,number>={};for(const[rel,file,mode]of _iter_files(base)){modes[rel]=mode;raw.set(rel,fs.lstatSync(file).isSymbolicLink()?symlink_payload(base,file):fs.readFileSync(file));}
    let name:any=path.basename(base),version:any=null;const manifestPath=manifests.find(file=>raw.has(file));
    if(manifestPath){const manifest=parseDocument(utf8(raw.get(manifestPath)!));if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new IdentityError('manifest is not a JSON object');name=manifest.name??null;version=manifest.version??null;}
    else{const skill=raw.get('SKILL.md')??[...raw].find(([rel])=>rel.endsWith('/SKILL.md'))?.[1];if(skill){const text=skill.toString('utf8');name=/^name:\s*([^\s#]+)/m.exec(text)?.[1]??name;version=/^\s+version:\s*([^\s#]+)/m.exec(text)?.[1]??null;}}
    const roles:Record<string,[string,Buffer][]>={runtime:[],test:[],assets:[],metadata:[]};for(const[rel,data]of raw){const role=classify_path(rel);roles[role]!.push([rel,role==='runtime'?_normalise_runtime(rel,data):data]);}
    const runtime=[...roles.runtime!],runtimeModes={...modes};for(const file of manifests)if(raw.has(file)){const synthetic='@runtime-manifest/'+file;runtime.push([synthetic,_normalise_manifest(raw.get(file)!)]);runtimeModes[synthetic]=modes[file]!;}
    const digests:Record<string,string>={};for(const role of ROLES)digests[role]='sha256:'+_digest(roles[role]!,modes);digests.runtime='sha256:'+_digest(runtime,runtimeModes);digests.tree='sha256:'+_digest(raw,modes);digests.versionNeutralTree='sha256:'+_digest([...raw].map(([rel,data])=>[rel,manifests.includes(rel)?_normalise_manifest(data):_normalise_runtime(rel,data)]),modes);
    return {schema:SCHEMA,algorithm:ALGORITHM,package:{name,version},digests,counts:Object.fromEntries(ROLES.map(role=>[role,roles[role]!.length]))};
  }catch(error){if(error instanceof IdentityError)throw error;throw new IdentityError(`cannot compute package identity: ${(error as globalThis.Error).message}`);}
}
export function classify_change(before:any,after:any):string{
  const left=before.digests??{},right=after.digests??{};if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)||Array.isArray(right))return 'invalid';const changed=[...ROLES,'tree'].filter(role=>left[role]!==right[role]);
  if(before.package&&after.package&&before.package.name===after.package.name&&before.package.version!==after.package.version&&left.versionNeutralTree&&left.versionNeutralTree===right.versionNeutralTree&&['runtime','test','assets'].every(role=>left[role]===right[role]))return 'version-only';
  if(!changed.length)return 'unchanged';if(JSON.stringify(changed)===JSON.stringify(['test','tree']))return 'test-only';return changed.includes('runtime')?'runtime':'mixed';
}
export function verify_receipt(root:string,receipt:string|any):[boolean,string[]]{
  let data:any;try{data=typeof receipt==='string'?JSON.parse(fs.readFileSync(receipt,'utf8')):receipt;}catch(error){return [false,[`receipt unreadable: ${(error as globalThis.Error).message}`]];}if(!data||typeof data!=='object'||Array.isArray(data))return [false,['receipt is not an object']];if('provenance'in data)return [false,['provenance is not an authenticity claim and is forbidden in identity receipts']];let current:any;try{current=compute_identity(root);}catch(error){return [false,[(error as globalThis.Error).message]];}const problems=['schema','algorithm','package','digests','counts'].filter(key=>!canonical(data[key]??null).equals(canonical(current[key]??null))).map(key=>`receipt mismatch: ${key}`);return [!problems.length,problems];
}
export function main(argv:string[]):number{const root=argv[0];let receipt:string|undefined;for(let i=1;i<argv.length;i++){if(argv[i]==='--json')continue;if(argv[i]==='--receipt'&&argv[i+1])receipt=argv[++i];else{console.error('usage: package_identity ROOT [--receipt FILE] [--json]');return 2;}}if(!root)return 2;try{if(receipt){const[ok,problems]=verify_receipt(root,receipt);console.log(JSON.stringify({ok,root:path.resolve(root),problems},null,1));return ok?0:1;}console.log(JSON.stringify(compute_identity(root),null,1));return 0;}catch(error){console.error(`[UNRUNNABLE] ${(error as globalThis.Error).message}`);return 2;}}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
