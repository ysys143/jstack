/** Owning contracts for imported Claude Code mods: byte binding, provenance, loading and wiring. */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {check_contract_coverage,check_no_constant_assertions,check_total,type Result} from '../skills/_suite_lib.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),MODS=join(ROOT,'mods');
const results:Result[]=[];
function check(name:string,ok:unknown,detail:unknown=''):void{results.push([name,Boolean(ok),detail]);console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' — '+String(detail):''}`);}
function read(path:string):string{try{return readFileSync(path,'utf8');}catch{return '';}}
function json(path:string):any{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return undefined;}}
function exists(path:string):boolean{try{return statSync(path).isFile();}catch{return false;}}
function files(dir:string):string[]{const out:string[]=[];const walk=(d:string)=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())walk(p);else out.push(relative(dir,p).split(sep).join('/'));}};walk(dir);return out.sort();}
const sha256=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
/** Files jstack adds to an imported mod folder; everything else must be bound to upstream bytes. */
const LOCAL=['NOTICE','UPSTREAM.sha256'];
/**
 * Each imported mod: the command it registers, the digest of its reviewed UPSTREAM.sha256 (so a regenerated
 * record needs a reviewed change here), and the deletion floor of each declared document.
 */
const DECLARED:Record<string,{command:string;record:string;per_file:Record<string,number>}>={
  'stack-viewer':{command:'stack',record:'b9598d48c2afc1d12bbf2f3d46d611e8ea6b1de3acf454d5cafa0e62beec1208',per_file:{'README.md':3,'NOTICE':5,'LICENSE':3,'UPSTREAM.sha256':12,'hooks/stack-viewer.tsx':3}},
};

function main():number{
  const present=readdirSync(MODS,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  check('Mods: every mod folder is declared by this suite',JSON.stringify(present)===JSON.stringify(Object.keys(DECLARED).sort()),present.join(', '));
  // Inside a built package Claude reads the package-root hooks/ copy, so that copy must exist; a bare payload has only its own.
  const inPackage=exists(join(dirname(ROOT),'.claude-plugin/plugin.json')),claudeFile=inPackage?join(dirname(ROOT),'hooks/claude-hooks.json'):join(ROOT,'hooks/claude-hooks.json');
  const claude=json(claudeFile),wired:string[]=[];
  for(const [name,spec] of Object.entries(DECLARED)){
    const dir=join(MODS,name),record=read(join(dir,'UPSTREAM.sha256'));
    // Byte binding: walk the folder, not the record, so a deleted record cannot hide a file.
    const header=/^# SHA-256 of imported files: ([^\s/]+\/[^\s/]+) @ ([0-9a-f]{40}) /m.exec(record);
    check(`${name}: UPSTREAM.sha256 names its repository and a full commit`,header,header?'':'no header');
    const reviewed=exists(join(dir,'UPSTREAM.sha256'))&&sha256(join(dir,'UPSTREAM.sha256'))===spec.record;
    check(`${name}: UPSTREAM.sha256 is the reviewed record`,reviewed,reviewed?'':'regenerated without updating this suite');
    const listed=new Map([...record.matchAll(/^([0-9a-f]{64}) {2}(\S.*)$/gm)].map(m=>[m[2],m[1]]));
    for(const rel of files(dir).filter(rel=>!LOCAL.includes(rel)))check(`${name}: ${rel} is recorded with its upstream bytes`,listed.get(rel)===sha256(join(dir,rel)),listed.get(rel)===sha256(join(dir,rel))?'':listed.has(rel)?'bytes differ from the record':'not recorded');
    check(`${name}: UPSTREAM.sha256 lists only files that exist`,[...listed.keys()].every(rel=>exists(join(dir,rel))),[...listed.keys()].filter(rel=>!exists(join(dir,rel))).join(', '));
    // Provenance the NOTICE must keep in step with the record.
    const notice=read(join(dir,'NOTICE')),repo=header?.[1]??'(unknown)',pin=header?.[2]??'(unknown)';
    check(`${name}: NOTICE links the upstream repository`,notice.includes(`https://github.com/${repo}`),repo);
    check(`${name}: NOTICE records the pinned commit`,notice.includes(`\`${pin.slice(0,7)}\``),pin.slice(0,7));
    check(`${name}: NOTICE says the copy is unchanged and names the local additions`,notice.includes('unchanged copy')&&notice.includes('the only local additions'));
    check(`${name}: NOTICE says the command is not namespaced`,notice.includes(`\`/${spec.command}\` registers under that bare name`)&&notice.includes(`\`/jstack:${spec.command}\` does not exist`));
    const license=read(join(dir,'LICENSE'));
    check(`${name}: LICENSE carries the MIT terms`,license.startsWith('MIT License')&&license.includes('Permission is hereby granted, free of charge'));
    // The mod stays a mod, so claude plugin test can run its upstream tests in place.
    const manifest=json(join(dir,'.claude-plugin/plugin.json'));
    check(`${name}: plugin.json names the folder and the MIT license`,manifest?.name===name&&manifest?.license==='MIT',`${manifest?.name} ${manifest?.license}`);
    const modules:unknown=json(join(dir,'hooks/hooks.json'))?.modules,own=Array.isArray(modules)?modules.filter((m):m is string=>typeof m==='string'):[];
    check(`${name}: its hooks.json names modules that exist`,own.length>0&&own.length===(modules as unknown[]).length&&own.every(m=>exists(join(dir,'hooks',m))),JSON.stringify(modules));
    const code=own.map(m=>read(join(dir,'hooks',m))).join('\n');
    check(`${name}: a module registers /${spec.command}`,new RegExp(`const COMMAND = '${spec.command}'`).test(code)&&code.includes('command: COMMAND'));
    check(`${name}: README says the mod only observes`,read(join(dir,'README.md')).includes('It only observes'));
    wired.push(...own.map(m=>`../payload/mods/${name}/hooks/${m.replace(/^\.\//,'')}`));
    check_contract_coverage(check,SUITE_FILE,dir,{per_file:spec.per_file});
  }
  // Module paths resolve from the hooks/ directory Claude reads; it loads one hooks module per plugin.
  const declaredModules:unknown=claude?.modules;
  check('Wiring: the Claude hook file names one module, the most Claude Code loads per plugin',Array.isArray(declaredModules)&&declaredModules.length===1,JSON.stringify(declaredModules));
  check('Wiring: the Claude hook file loads exactly the imported mods',JSON.stringify(declaredModules)===JSON.stringify(wired),JSON.stringify(declaredModules));
  check('Wiring: every Claude hook module resolves into the payload',Array.isArray(declaredModules)&&declaredModules.length>0&&declaredModules.every(m=>typeof m==='string'&&m.startsWith('../payload/')&&exists(join(ROOT,m.slice('../payload/'.length)))));
  for(const shared of ['hooks/hooks.json','hooks/codex-hooks.json']){const value=json(join(ROOT,shared));check(`Wiring: ${shared}, which Codex reads, exists and declares no modules`,value!==undefined&&!('modules' in value));}
  check('Docs: NOTICE.md lists each imported mod',Object.keys(DECLARED).every(name=>read(join(ROOT,'NOTICE.md')).includes(`\`hosts/claude/mods/${name}\``)));
  check('Docs: CAPABILITIES.md documents each mod command',Object.values(DECLARED).every(spec=>read(join(ROOT,'CAPABILITIES.md')).includes(`\`/${spec.command}\``)));
  check_no_constant_assertions(check,SUITE_FILE);
  check_total(check,results,35);
  const passed=results.filter(([,ok])=>ok).length;
  console.log(`\n${passed}/${results.length} 통과`);
  return passed===results.length?0:1;
}
process.exitCode=main();
