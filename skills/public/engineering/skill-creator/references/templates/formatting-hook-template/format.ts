#!/usr/bin/env node
/** Formatting hook template. Optional language formatters are never installed automatically. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function load_config(env=process.env){const indent=Number(env.HOOK_INDENT??2);if(!Number.isInteger(indent)||indent<0||indent>10)throw new Error('HOOK_INDENT must be an integer from 0 to 10');return{indent,trailing_newline:(env.HOOK_TRAILING_NEWLINE??'true')==='true',trim_whitespace:(env.HOOK_TRIM_WHITESPACE??'true')==='true'};}
export function format_file(file:string,config=load_config()):boolean{
  if(!existsSync(file)||!statSync(file).isFile()){console.log('[WARN] File not found: '+file);return true;}
  const extension=extname(file);
  if(extension==='.json'){let data;try{data=JSON.parse(readFileSync(file,'utf8'));}catch{console.log('[FAIL] Invalid JSON: '+file);return false;}writeFileSync(file,JSON.stringify(data,null,config.indent)+'\n');console.log('[OK] Formatted JSON: '+file);return true;}
  if(extension==='.md'){let text=readFileSync(file,'utf8');if(config.trim_whitespace)text=text.replace(/[^\S\r\n]+(?=\r?$)/gm,'');if(config.trailing_newline&&text&&!text.endsWith('\n'))text+='\n';writeFileSync(file,text);console.log('[OK] Formatted Markdown: '+file);return true;}
  if(extension==='.sh'||extension==='.py'){const command=extension==='.sh'?'shfmt':'black',args=extension==='.sh'?['-w','-i','4','-bn','-ci','-sr',file]:['-q',file],out=spawnSync(command,args,{stdio:'inherit'});if(out.error&&(out.error as NodeJS.ErrnoException).code==='ENOENT'){console.log(`[WARN] ${command} not found, skipping ${extension==='.sh'?'shell':'Python'} formatting`);return true;}if(out.status!==0)return false;console.log(`[OK] Formatted ${extension==='.sh'?'Shell':'Python'}: ${file}`);return true;}
  console.log('[INFO] No formatter for: '+file);return true;
}
export function format_all(patterns=['*.json','*.md','*.sh','*.py'],root='.',config=load_config()):boolean{
  const files:string[]=[];const visit=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){if(['node_modules','.git'].includes(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory())visit(path);else if(entry.isFile())files.push(path);}};visit(root);let count=0,passed=true;
  for(const pattern of patterns){const regex=new RegExp('^'+pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*').replaceAll('?','.')+'$');for(const file of files)if(regex.test(basename(file))){if(format_file(file,config))count++;else passed=false;}}
  console.log(`\n[OK] Formatted ${count} files`);return passed;
}
export function read_stdin_file_path():string|undefined{if(process.stdin.isTTY)return;try{const payload=JSON.parse(readFileSync(0,'utf8'));return typeof payload.tool_input?.file_path==='string'?payload.tool_input.file_path:undefined;}catch{return;}}
export function main(argv=process.argv.slice(2)):number{if(['--help','-h'].includes(argv[0])){console.log('format.js [files...]\nEnvironment: HOOK_INDENT, HOOK_TRAILING_NEWLINE, HOOK_TRIM_WHITESPACE');return 0;}const config=load_config();if(argv.length){let passed=true;for(const file of argv)if(!format_file(file,config))passed=false;return passed?0:1;}const file=read_stdin_file_path();return(file?format_file(file,config):format_all(undefined,'.',config))?0:1;}
function isEntry():boolean { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if(isEntry())process.exitCode=main();
