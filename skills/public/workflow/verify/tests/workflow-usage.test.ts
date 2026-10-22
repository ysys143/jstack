import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {USAGE,parse_arguments} from '../scripts/workflow.js';
const cli=fileURLToPath(new URL('../scripts/workflow.js',import.meta.url));
const parsedArgs=(input:string[])=>{const parsed=parse_arguments(input);assert.ok('args' in parsed,input.join(' ')+' should parse: '+JSON.stringify(parsed));return parsed.args;};
const parsedError=(input:string[])=>{const parsed=parse_arguments(input);assert.ok('error' in parsed,input.join(' ')+' should be rejected: '+JSON.stringify(parsed));return parsed.error;};
test('a help request is recognized wherever a token is not an option value',()=>{
 for(const input of [['--help'],['-h'],['status','--help'],['status','-h'],['status','x','--help'],['init','--help'],['init','x','--help'],['interrupt','x','--evidence','e.txt','--help'],['status','x','--timeout-seconds','5','--help'],['record-review','x','--raw-output','r.txt','--help'],['record-review','x','ADD-1','-h'],['verify','x','--bogus','--help'],['verify','x','--json','-h'],['bogus','--help']])
  assert.deepEqual(parse_arguments(input),{help:true},input.join(' '));
});
test('a help word that is an option value is a value, not a help request',()=>{
 assert.match(parsedError(['verify','x','--timeout-seconds','-h']),/^--timeout-seconds must be a number greater than zero$/);
 assert.equal(parsedArgs(['interrupt','x','--cursor-file','-h']).cursor_file,'-h');
 assert.deepEqual(parsedArgs(['interrupt','x','--evidence','--help','--cursor-file','c.txt']).evidence,['--help']);
});
test('an unknown option is named, and an unknown option is not reported as a missing value',()=>{
 assert.equal(parsedError(['status','x','--json']),'unknown option --json; see workflow --help');
 assert.equal(parsedError(['status','x','--json','1']),'unknown option --json; see workflow --help');
 assert.equal(parsedError(['status','x','--json=1']),'unknown option --json; see workflow --help');
 assert.equal(parsedError(['status','x','-j']),'unknown option -j; see workflow --help');
 assert.equal(parsedError(['verify','x','--bogus','--timeout-seconds']),'unknown option --bogus; see workflow --help','the first problem wins');
});
test('an option without a value says which option',()=>{
 for(const [input,flag] of [[['verify','bug-1','--timeout-seconds'],'--timeout-seconds'],[['interrupt','bug-1','--cursor-file'],'--cursor-file'],[['interrupt','bug-1','--cursor-file','c.txt','--evidence'],'--evidence']] as [string[],string][])
  assert.equal(parsedError(input),flag+' requires a value',input.join(' '));
});
test('a missing or invalid required argument says which one',()=>{
 for(const [input,message] of [
  [['init','bug-1'],'init requires a contract path'],
  [['interrupt','bug-1'],'interrupt requires --cursor-file'],
  [['record-review','bug-1'],'record-review requires REQUIREMENT, KIND and --raw-output'],
  [['record-review','bug-1','ADD-1','cold-read'],'record-review requires REQUIREMENT, KIND and --raw-output'],
  [['record-review','bug-1','ADD-1','cold-read','--raw-output','review.txt'],'record-review requires --verdict pass or fail'],
  [['record-review','bug-1','ADD-1','cold-read','--raw-output','review.txt','--verdict','maybe'],'record-review requires --verdict pass or fail'],
  [['verify','bug-1','--timeout-seconds','0'],'--timeout-seconds must be a number greater than zero'],
  [['verify','bug-1','--timeout-seconds','soon'],'--timeout-seconds must be a number greater than zero'],
  [['verify','bug-1','--timeout-seconds='],'--timeout-seconds must be a number greater than zero'],
  [[],'an action and a task ID are required'],
  [['status'],'an action and a task ID are required'],
  [['status','--json'],'an action and a task ID are required'],
  [['status','--timeout-seconds','5'],'an action and a task ID are required'],
  [['verify','-x'],'an action and a task ID are required'],
  [['bogus','bug-1'],'unknown action bogus'],
  [['status','bug-1','extra'],'unexpected argument extra'],
  [['init','bug-1','a.yaml','b.yaml'],'unexpected argument b.yaml']
 ] as [string[],string][])assert.equal(parsedError(input),message,input.join(' '));
});
test('an option is rejected for an action that does not take it, as in the Python twin',()=>{
 for(const [input,option,action] of [
  [['status','x','--timeout-seconds','5'],'--timeout-seconds','status'],
  [['init','x','c.yaml','--timeout-seconds','5'],'--timeout-seconds','init'],
  [['init','x','--timeout-seconds','5','c.yaml'],'--timeout-seconds','init'],
  [['brief','x','--timeout-seconds=5'],'--timeout-seconds','brief'],
  [['resume','x','--timeout-seconds'],'--timeout-seconds','resume'],
  [['verify','x','--cursor-file','c.txt'],'--cursor-file','verify'],
  [['interrupt','x','--cursor-file','c.txt','--verdict','pass'],'--verdict','interrupt'],
  [['record-review','x','ADD-1','cold-read','--raw-output','r.txt','--verdict','pass','--evidence','e.txt'],'--evidence','record-review']
 ] as [string[],string,string][])assert.equal(parsedError(input),option+' does not apply to '+action,input.join(' '));
 assert.equal(parsedError(['status','x','--timeout-seconds','-h']),'--timeout-seconds does not apply to status','the value of an inapplicable option is still a value');
 for(const input of [['preflight','x','--timeout-seconds','5'],['verify','x','--timeout-seconds=5'],['interrupt','x','--cursor-file','c.txt','--evidence','e.txt']])parsedArgs(input);
});
test('options take --option=VALUE, like the Python twin, and may precede positional arguments',()=>{
 assert.equal(parsedArgs(['verify','bug-1','--timeout-seconds=5']).timeout_seconds,5);
 assert.equal(parsedArgs(['verify','bug-1']).timeout_seconds,120);
 assert.equal(parsedArgs(['init','bug-1','contract.yaml']).contract,'contract.yaml');
 const review=parsedArgs(['record-review','bug-1','--verdict=pass','ADD-1','cold-read','--raw-output=review.txt','--reviewed-file=a.txt','--reviewed-file','b.txt']);
 assert.deepEqual([review.requirement,review.kind,review.raw_output,review.verdict,review.reviewed_file],['ADD-1','cold-read','review.txt','pass',['a.txt','b.txt']]);
});
test('record-review preserves review mode, ID and blocking findings in either option form',()=>{
 for(const [input,mode] of [
  [['record-review','bug-1','ADD-1','cold-read','--raw-output','review.txt','--verdict','pass','--review-mode','broad','--review-id','review-1','--blocking-findings','findings.json'],'broad'],
  [['record-review','bug-1','--review-mode=focused','--review-id=review-2','--blocking-findings=findings.json','ADD-1','cold-read','--raw-output=review.txt','--verdict=fail'],'focused']
 ] as [string[],string][]){const review=parsedArgs(input);assert.deepEqual([review.review_mode,review.review_id,review.blocking_findings],[mode,mode==='broad'?'review-1':'review-2','findings.json'],input.join(' '));}
 for(const input of [
  ['record-review','bug-1','ADD-1','cold-read','--raw-output','review.txt','--verdict','pass','--review-mode','invalid'],
  ['record-review','bug-1','ADD-1','cold-read','--raw-output','review.txt','--verdict','pass','--review-mode=invalid']
 ])assert.equal(parsedError(input),'--review-mode must be broad or focused',input.join(' '));
});
test('workflow.js reports these outcomes on the right stream with the right exit code',t=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'jstack-workflow-usage-'));t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 const run=(...args:string[])=>{const result=spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',timeout:30000});return {code:result.status,out:result.stdout,err:result.stderr};};
 for(const args of [['--help'],['status','--help']]){const result=run(...args);assert.deepEqual(result,{code:0,out:USAGE,err:''},args.join(' '));}
 for(const action of ['init','preflight','brief','resume','verify','status','interrupt','record-review'])assert.match(USAGE,new RegExp('^  '+action+' TASK','m'));
 const json=run('status','x','--json');assert.equal(json.code,2);assert.equal(json.out,'');assert.match(json.err,/^workflow: unknown option --json/m);
 const value=run('verify','bug-1','--timeout-seconds');assert.equal(value.code,2);assert.equal(value.out,'');assert.match(value.err,/^workflow: --timeout-seconds requires a value$/m);
 const required=run('init','bug-1');assert.equal(required.code,2);assert.equal(required.out,'');assert.match(required.err,/^workflow: init requires a contract path$/m);
 const none=run();assert.equal(none.code,2);assert.equal(none.out,'');assert.match(none.err,/^workflow: an action and a task ID are required\n/);assert.ok(none.err.endsWith(USAGE),'a call without arguments shows the usage on stderr');
});
