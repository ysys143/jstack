import test from 'node:test';
import assert from 'node:assert/strict';
import {render_evidence,parse_arguments} from '../scripts/workflow.js';

const contract={'검증':[
  {'요구ID':'R1','명령':{'실행':'npm test','기대종료':0},'반증':{'실행':'npm test --prefix {RED_ROOT}','기대종료':1},'추가검토':[{'종류':'factual','적용':'생략','생략사유':'no external facts'}]},
  {'요구ID':'R2','명령':{'실행':'node check.js','기대종료':0},'반증':{'실행':'node check.js {RED_ROOT}','기대종료':1}},
  {'요구ID':'R3','명령':{'실행':'make e2e','기대종료':0},'반증':{'실행':'make e2e RED={RED_ROOT}','기대종료':1}},
]};
const run=(exitCode:number,timedOut=false)=>({exitCode,timedOut});
const receipt={head:'0123456789abcdef',recordedAt:'2026-11-03T00:00:00Z',targetsStable:true,missingReviews:['R2:human'],requirements:[
  {requirementId:'R1',positive:run(0),negativeControl:run(1),passed:true},
  {requirementId:'R2',positive:run(0),negativeControl:run(0),passed:false},
]};

const section=(lines:string[],title:string)=>{const start=lines.indexOf(title),end=lines.indexOf('',start);return lines.slice(start+1,end);};

test('a passing requirement is listed as verified with both exit codes',()=>{
  const verified=section(render_evidence('t1',receipt,contract,[]),'Verified');
  assert.deepEqual(verified,['- R1: `npm test` exit 0 (expected 0); RED `npm test --prefix {RED_ROOT}` exit 1 (expected 1)']);
});

test('failures, skipped and missing reviews, and unrun requirements are listed as not verified',()=>{
  const open=section(render_evidence('t1',receipt,contract,[]),'Not verified');
  assert.ok(open.some(line=>line.startsWith('- R2: failed')),open.join('\n'));
  assert.ok(open.includes('- R1 factual review: skipped — no external facts'),open.join('\n'));
  assert.ok(open.includes('- R2:human review: required, no passing review receipt'),open.join('\n'));
  assert.ok(open.includes('- R3: not run in this receipt'),open.join('\n'));
});

test('a stale receipt and changed targets are not verified',()=>{
  const open=section(render_evidence('t1',{...receipt,targetsStable:false},contract,['head-stale']),'Not verified');
  assert.ok(open.includes('- target files changed while the checks ran'));
  assert.ok(open.includes('- receipt is not current: head-stale'));
});

test('the record states its scope so an empty list is not read as full coverage',()=>{
  const all=render_evidence('t1',{...receipt,missingReviews:[],requirements:contract['검증'].map(req=>({requirementId:req['요구ID'],positive:run(0),negativeControl:run(1),passed:true}))},{'검증':contract['검증'].map(({['추가검토']:_,...req})=>req)},[]);
  assert.deepEqual(section(all,'Not verified'),['- nothing recorded']);
  assert.match(all.at(-1)!,/requirements of this contract only/);
});

test('evidence is an action that takes no options',()=>{
  const parsed=parse_arguments(['evidence','t1']);
  assert.ok('args' in parsed&&parsed.args.action==='evidence');
  assert.deepEqual(parse_arguments(['evidence','t1','--timeout-seconds','5']),{error:'--timeout-seconds does not apply to evidence'});
});
