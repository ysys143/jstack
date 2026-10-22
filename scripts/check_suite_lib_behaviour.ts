import { isMain } from '../runtime/entry.js';
/** Exercise the actual compiled shared library, including frozen-reference axes. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {pathToFileURL} from 'node:url';
import {sourceRoot} from './doctor-work.js';
export async function checkSuiteLibBehaviour(root=sourceRoot()){
  const source=path.join(root,'skills/_suite_lib.ts'),compiled=path.join(root,'dist/skills/_suite_lib.js');
  const installed=path.join(root,'skills/_suite_lib.js');const target=fs.existsSync(compiled)?compiled:installed;
  const results:{name:string;ok:boolean;detail:string}[]=[];const check=(name:string,ok:boolean,detail='')=>results.push({name,ok,detail});
  if(!fs.existsSync(target))return {code:2,lines:[`[FAIL] compiled shared library missing: ${target}`],results};
  const lib:any=await import(pathToFileURL(target).href);for(const name of ['content_bytes','ref_lines','survival_rate','_ref_axes'])if(typeof lib[name]!=='function')return {code:2,lines:[`[FAIL] shared library API missing: ${name}`],results};
  const axes=(body:string,frozen:string,floor:number,needles:string[])=>{const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jstack-axes-')));try{const skill=path.join(temp,'skill'),file=path.join(skill,'references/f.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(path.join(skill,'tests/refs'),{recursive:true});fs.writeFileSync(file,body);fs.writeFileSync(path.join(skill,'tests/refs/f.md.lines'),'# blob:0000\n'+lib.ref_lines(frozen).join('\n'));const failures:string[]=[];lib._ref_axes((name:string,ok:boolean)=>{if(!ok)failures.push(name);},skill,'f.md',file,body,needles,floor,'tests/refs','T');return failures;}finally{fs.rmSync(temp,{recursive:true,force:true});}};
  const frozen=Array.from({length:10},(_,i)=>`line-${i} 내용이 있는 줄`).join('\n');
  check('survival constant is 0.70',lib.SURVIVAL_FLOOR===0.7);check('50% fails and 80% passes',0.5<lib.SURVIVAL_FLOOR&&lib.SURVIVAL_FLOOR<=0.8);
  const text=fs.readFileSync(fs.existsSync(source)?source:target,'utf8');check('both survival axes use the constant',!(/rate\s*>=\s*[0-9.]+/.test(text))&&(text.match(/rate\s*>=\s*SURVIVAL_FLOOR/g)??[]).length>=2);
  const bytes=lib.content_bytes(frozen);check('volume one below floor fails',axes(frozen,frozen,bytes+1,[]).some(name=>/부피|volume/.test(name)));check('volume exactly at floor passes',!axes(frozen,frozen,bytes,[]).some(name=>/부피|volume/.test(name)));
  check('missing needle fails',axes(frozen,frozen,1,['없는문자열']).some(name=>name.includes('needle')));check('duplicate lines do not pad bytes',lib.content_bytes(Array(10).fill('같은 줄이다').join('\n'))===lib.content_bytes('같은 줄이다'));
  check('needles are excluded from bytes',lib.content_bytes('abc def',['abc'])<lib.content_bytes('abc def'));check('survival measures order',lib.survival_rate(['d','c','b','a'],['a','b','c','d'])<1);
  return {code:results.every(result=>result.ok)?0:1,lines:[...results.map(result=>`[${result.ok?'PASS':'FAIL'}] ${result.name}${result.detail?' — '+result.detail:''}`),`${results.filter(result=>result.ok).length}/${results.length} passed`],results};
}
if(isMain(import.meta.url)){try{const result=await checkSuiteLibBehaviour(process.argv[2]?path.resolve(process.argv[2]):undefined);console.log(result.lines.join('\n'));process.exitCode=result.code;}catch(error){console.error(`[FAIL] shared library crashed: ${(error as Error).message}`);process.exitCode=2;}}
