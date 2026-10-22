/** Shared authoring filesystem and literal-argv process boundaries. */
import * as fs from 'node:fs';
import {basename,dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {runProcess,atomicWrite} from '../../../../../runtime/os.js';
import {validatePlugin} from './validate_plugin.js';
export type Runner=(command:string,args:string[],options?:Parameters<typeof runProcess>[2])=>{status:number|null;stdout?:string|null;stderr?:string|null;error?:Error};
export const defaultRunner:Runner=runProcess;
export const file=(path:string)=>{try{return fs.statSync(path).isFile();}catch{return false;}},directory=(path:string)=>{try{return fs.statSync(path).isDirectory();}catch{return false;}},exists=(path:string)=>{try{fs.lstatSync(path);return true;}catch{return false;}};
export function name(value:string,label='name'):void{if(!/^[a-z][a-z0-9-]*$/.test(value))throw Error(`${label} is not kebab-case: ${value}`);}
export const claudeDir=(env:NodeJS.ProcessEnv)=>env.CLAUDE_CONFIG_DIR||join(env.HOME||homedir(),'.claude');
export const marketplaceDir=(env:NodeJS.ProcessEnv)=>env.JSTACK_MARKETPLACE_DIR||join(claudeDir(env),'plugins/marketplaces/local-plugins');
export function json(path:string):any{return JSON.parse(fs.readFileSync(path,'utf8'));}
export function atomicJson(path:string,value:unknown):void{const actual=join(fs.realpathSync(dirname(path)),basename(path));atomicWrite(actual,Buffer.from(JSON.stringify(value,null,2)+'\n'),false);}
export function copy(source:string,target:string):void{fs.cpSync(source,target,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});}
export function files(root:string,includeDirectories=false):string[]{const out:string[]=[];function walk(path:string){const stat=fs.lstatSync(path);if(stat.isFile())out.push(path);else if(stat.isDirectory()){if(includeDirectories)out.push(path);for(const child of fs.readdirSync(path).sort())walk(join(path,child));}}walk(root);return out.sort();}
export function stagePlugin(source:string,pluginName:string):{root:string;cleanup:()=>void}{name(pluginName,'plugin name');if(!directory(source))throw Error(`plugin source directory does not exist: ${source}`);const temporary=fs.mkdtempSync(join(tmpdir(),'jstack-author-')),root=join(temporary,pluginName);try{copy(source,root);const validation=validatePlugin(root);if(validation.code!==0)throw Error(`plugin validation failed:\n${validation.output.trimEnd()}`);return{root,cleanup:()=>fs.rmSync(temporary,{recursive:true})};}catch(e){fs.rmSync(temporary,{recursive:true});throw e;}}
export function run(runner:Runner,command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,required=true):string{const result=runner(command,args,{cwd,env});if(required&&(result.error||result.status!==0))throw Error(result.stderr?.trim()||result.error?.message||`${command} failed (${result.status})`);return result.stdout??'';}
export function available(runner:Runner,command:string,cwd:string,env:NodeJS.ProcessEnv):boolean{const result=runner(command,['--version'],{cwd,env});return !result.error&&result.status===0;}
export function restoreBranch(runner:Runner,branch:string,cwd:string,env:NodeJS.ProcessEnv):void{if(branch)run(runner,'git',['checkout',branch],cwd,env,false);}
export function temporaryBody(parent:string,body:string):{path:string;cleanup:()=>void}{const path=join(parent,`.jstack-pr-${randomUUID()}.md`);fs.writeFileSync(path,body,{flag:'wx',mode:0o600});return{path,cleanup:()=>{if(exists(path))fs.unlinkSync(path);}};}
export function assertWithin(parent:string,path:string):void{const rel=relative(resolve(parent),resolve(path));if(!rel||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('destination escaped its package scope');}
