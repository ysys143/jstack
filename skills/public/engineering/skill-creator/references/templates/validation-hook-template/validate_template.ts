#!/usr/bin/env node
/** Validation hook template. Replace the example checks with project rules. */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
export class ValidationError {
  constructor(public rule:string,public message:string,public location:string,public fix:string,public severity='error'){}
  toString(){return `${this.severity==='error'?'[FAIL]':'[WARN]'} ${this.message}\n  Location: ${this.location}\n  Fix: ${this.fix}`;}
}
export class Validator {
  errors:ValidationError[]=[];warnings:ValidationError[]=[];
  constructor(public config:Record<string,any>){}
  get severity():string{return this.config.severity??'error';}
  get auto_fix_enabled():boolean{return this.config.auto_fix??false;}
  get rules():Record<string,unknown>{return this.config.rules??{};}
  validate(_targetPath:string):boolean{
    // TODO: Add project checks, such as check_file_exists or check_json_schema.
    return this.errors.length===0;
  }
  add_error(rule:string,message:string,location:string,fix:string,severity=this.severity){const error=new ValidationError(rule,message,location,fix,severity);(severity==='error'?this.errors:this.warnings).push(error);}
  check_file_exists(path:string):boolean{if(existsSync(path))return true;this.add_error('file_exists',`Required file not found: ${basename(path)}`,path,`Create file: ${path}`);return false;}
  check_json_schema(path:string,fields:string[]):boolean{
    if(!this.check_file_exists(path))return false;let data:unknown;
    try{data=JSON.parse(readFileSync(path,'utf8'));}catch(error){this.add_error('json_syntax',`Invalid JSON syntax in ${basename(path)}`,path,'Fix JSON syntax error');return false;}
    for(const field of fields)if(data===null||typeof data!=='object'||!Object.hasOwn(data,field))this.add_error('required_field',`Missing required field: ${field}`,path,`Add "${field}" field to JSON`);return this.errors.length===0;
  }
  check_naming_convention(name:string,pattern:string,description:string):boolean{if(new RegExp('^(?:'+pattern+')').test(name))return true;this.add_error('naming_convention',`Invalid ${description}: ${name}`,name,`Use pattern: ${pattern}`);return false;}
  auto_fix():boolean{
    if(!this.auto_fix_enabled)return false;
    // TODO: Implement fixes for each project-specific error type.
    return false;
  }
  report(){for(const [title,items]of [['[FAIL] Validation failed:',this.errors],['[WARN] Warnings:',this.warnings]] as const){if(items.length){console.log('\n'+title+'\n');for(const item of items)console.log(`  - ${item.message}\n    Location: ${item.location}\n    Fix: ${item.fix}\n`);}}if(!this.errors.length&&!this.warnings.length)console.log('[OK] Validation passed');}
}
export function load_hook_config():Record<string,any>{
  let config:Record<string,any>={};try{const data=parse(readFileSync('pyproject.toml','utf8')) as any;config={...(data.tool?.['claude-hooks']??{})};}catch{/* Missing or invalid optional configuration uses defaults. */}
  if(process.env.HOOK_SEVERITY)config.severity=process.env.HOOK_SEVERITY;if(process.env.HOOK_AUTO_FIX!==undefined)config.auto_fix=['1','true','yes'].includes(process.env.HOOK_AUTO_FIX.trim().toLowerCase());return config;
}
export function read_hook_payload():any{if(process.stdin.isTTY)return{};try{const value=JSON.parse(readFileSync(0,'utf8'));return value&&typeof value==='object'?value:{};}catch{return{};}}
export function main(argv=process.argv.slice(2)):number{const config=load_hook_config(),target=argv[0]??read_hook_payload().tool_input?.file_path??process.cwd();let validator=new Validator(config),valid=validator.validate(resolve(target));if(!valid&&validator.auto_fix_enabled&&validator.auto_fix()){validator=new Validator(config);valid=validator.validate(resolve(target));if(valid)console.log('[OK] Auto-fix successful');}validator.report();return valid?0:1;}
function isEntry():boolean { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if(isEntry())process.exitCode=main();
