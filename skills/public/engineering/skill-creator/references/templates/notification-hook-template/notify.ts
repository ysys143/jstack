#!/usr/bin/env node
/** Notification hook template; external channels require explicit configuration. */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export interface Config {rate_limit:{enabled:boolean;max_per_hour:number};webhook_url:string;template:string;channels:string[];notify_on:Record<string,boolean>}
export function load_config(env=process.env):Config {const max=Number(env.HOOK_RATE_LIMIT_MAX_PER_HOUR??10);if(!Number.isSafeInteger(max)||max<0)throw new Error('HOOK_RATE_LIMIT_MAX_PER_HOUR must be a nonnegative integer');return{rate_limit:{enabled:(env.HOOK_RATE_LIMIT_ENABLED??'true')==='true',max_per_hour:max},webhook_url:env.HOOK_SLACK_WEBHOOK_URL??env.SLACK_WEBHOOK_URL??'',template:env.HOOK_NOTIFY_TEMPLATE??'default',channels:(env.HOOK_NOTIFY_CHANNELS??'console').split(','),notify_on:{}};}
export async function check_rate_limit(config:Config,directory=join(tmpdir(),'jstack-hook-notifications-'+(process.getuid?.()??process.env.USERNAME??'user')),now=Date.now()):Promise<boolean>{
  if(!config.rate_limit.enabled)return true;
  mkdirSync(directory,{recursive:true,mode:0o700});const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid())||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Notification rate directory is not private');
  const lock=join(directory,'.lock'),file=join(directory,'notify.json');let acquired=false;
  for(let attempt=0;attempt<100;attempt++){try{mkdirSync(lock,{mode:0o700});acquired=true;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await delay(20);}}
  if(!acquired)throw new Error('Notification rate lock is busy; inspect stale lock before retrying');
  try{let times:number[]=[];if(existsSync(file)){if(lstatSync(file).isSymbolicLink())throw new Error('Notification rate file is a symlink');const data=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(data)||data.some(x=>!Number.isFinite(x)))throw new Error('Invalid notification rate history');times=data.filter(x=>x>now-3600_000);}
    if(times.length>=config.rate_limit.max_per_hour){console.error(`[WARN] Rate limit exceeded (${times.length}/${config.rate_limit.max_per_hour} per hour)`);return false;}
    times.push(now);const temp=join(lock,'next.json');writeFileSync(temp,JSON.stringify(times)+'\n',{mode:0o600});renameSync(temp,file);return true;
  }finally{rmSync(lock,{recursive:true});}
}
export function notify_console(level:string,message:string){const prefix:Record<string,string>={success:'[OK]',failure:'[FAIL]',warning:'[WARN]'};console.log(`${prefix[level]??'[INFO]'} ${message}`);}
export async function notify_slack(url:string,message:string):Promise<boolean>{if(!url||url==='null')return false;try{return(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:message}),signal:AbortSignal.timeout(10_000)})).ok;}catch{return false;}}
export function notify_desktop(title:string,message:string):boolean{
  if(process.platform==='darwin'){const result=spawnSync('osascript',['-e','on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run',title,message],{stdio:'ignore',timeout:10_000});return result.status===0;}
  return spawnSync('notify-send',[title,message],{stdio:'ignore',timeout:10_000}).status===0;
}
export function get_event_context(event:string):Record<string,unknown>{
  const git=(args:string[])=>spawnSync('git',args,{encoding:'utf8',timeout:10_000});
  if(['commit','post_commit'].includes(event)){if(git(['rev-parse','--git-dir']).status!==0)return{};return{hash:git(['rev-parse','--short','HEAD']).stdout.trim()||'unknown',message:git(['log','-1','--pretty=%s']).stdout.trim(),author:git(['log','-1','--pretty=%an']).stdout.trim()};}
  if(['generate','post_generate'].includes(event))try{const data=JSON.parse(readFileSync('.claude-plugin/plugin.json','utf8'));return{name:data.name??null,version:data.version??null,description:data.description??null};}catch{return{};}return{};
}
export function render_template(template:string,context:Record<string,unknown>):string{if(template==='commit_success')return`Commit successful: ${context.hash??'unknown'}\nAuthor: ${context.author??''}\nMessage: ${context.message??''}`;if(template==='plugin_generated')return`Plugin generated: ${context.name??'unknown'} v${context.version??'0.0.0'}`;return JSON.stringify(context);}
export async function send_notifications(config:Config,level:string,message:string):Promise<void>{let sent=false;for(const channel of config.channels){if(channel==='console'){notify_console(level,message);sent=true;}else if(channel==='slack')sent=await notify_slack(config.webhook_url,message)||sent;else if(channel==='desktop')sent=notify_desktop('Plugin Event',message)||sent;else console.error('[WARN] Unknown notification channel: '+channel);}if(!sent)notify_console(level,message);}
export async function main(argv=process.argv.slice(2)):Promise<number>{if(['--help','-h'].includes(argv[0])){console.log('notify.js [event] [level]\nEnvironment: HOOK_RATE_LIMIT_ENABLED, HOOK_RATE_LIMIT_MAX_PER_HOUR, HOOK_NOTIFY_CHANNELS, HOOK_SLACK_WEBHOOK_URL, HOOK_NOTIFY_TEMPLATE');return 0;}let payload:any={};if(!process.stdin.isTTY)try{payload=JSON.parse(readFileSync(0,'utf8')||'{}');}catch{}const event=argv[0]??payload.tool_name??'unknown',level=argv[1]??'info',config=load_config();if(config.notify_on[level]===false||!await check_rate_limit(config))return 0;await send_notifications(config,level,render_template(config.template,get_event_context(event)));return 0;}
function isEntry():boolean { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if(isEntry())main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(String(error));process.exitCode=1;});
