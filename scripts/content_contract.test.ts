import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {spawnSync} from 'node:child_process';
import {anchors,evaluate,machineTextCheck,procurementCheck,propositions,sha256,parseDocument} from './content_contract.js';
function fixture(t:any,before:string,after:string){const root=fs.mkdtempSync(path.join(os.tmpdir(),'jstack-fidelity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const left=path.join(root,'before'),right=path.join(root,'after'),review=path.join(root,'review.json');fs.writeFileSync(left,before);fs.writeFileSync(right,after);return {left,right,review};}
test('anchors retain multiplicity, quotes, Unicode digits, requirement IDs, and negation signals',()=>{
  assert.deepEqual(anchors('REQ-12 "약속" ٢٣%').quotes,['약속']);assert.ok(anchors('٢٣%').numbers.includes('٢٣%'));
  assert.match(machineTextCheck('3개 3개 지원하지 못했다','3개 완전히 지원').failures.join('\n'),/numbers-changed/);
  assert.ok(machineTextCheck('미검증','검증됨').review_flags.length);
});
test('changed wording remains provisional without review; byte-identical content is unchanged',t=>{
  const {left,right}=fixture(t,'내용을 보존한다.','내용을 유지한다.');assert.equal(evaluate(left,right).accepted,false);
  fs.copyFileSync(left,right);assert.equal(evaluate(left,right).status,'unchanged');assert.equal(evaluate(left,right).accepted,true);
});
test('review must cover every proposition with matching source/output spans and independent artifact',t=>{
  const before='첫 문장을 보존한다. 둘째도 보존한다.',after='첫 문장을 유지한다. 둘째도 유지한다.';const {left,right,review}=fixture(t,before,after);
  const record={beforeSha256:sha256(left),afterSha256:sha256(right),independence:'external-artifact',coverage:propositions(before).map((p,i)=>({propositionId:p.id,status:'verified',evidenceSpans:[{source:p.source,output:propositions(after)[i]!.source}]}))};
  fs.writeFileSync(review,JSON.stringify(record));assert.equal(evaluate(left,right,'general',review).accepted,true);
  record.coverage.pop();fs.writeFileSync(review,JSON.stringify(record));assert.ok(evaluate(left,right,'general',review).failures.includes('review-proposition-coverage'));
  record.coverage[0]!.evidenceSpans[0]!.output='invented';record.independence='unverified';fs.writeFileSync(review,JSON.stringify(record));assert.ok(evaluate(left,right,'general',review).failures.includes('review-independence-unverified'));assert.ok(evaluate(left,right,'general',review).failures.some((f:string)=>f.includes('evidence-mismatch')));
});
test('procurement rejects changed IDs, duplicate evidence, lost unknowns, and unsafe-integer obligations',t=>{
  const source={requirements:[{id:'REQ-1',minimum:20,description:'암호화 지원'}],evidence:['E','E'],unknowns:['미정']};
  const changed={requirements:[{id:'REQ-1',minimum:21,description:'평문 지원'}],evidence:['E'],unknowns:[]};const result=procurementCheck(source,changed);
  for(const failure of ['requirement-value-changed:REQ-1:minimum','evidence-set-changed','unknown-removed'])assert.ok(result.failures.includes(failure));assert.ok(result.review_flags.length);
  assert.equal(parseDocument('{"minimum":9007199254740993}').minimum,9007199254740993n);
  const {left,right}=fixture(t,'{"requirements":[{"id":"REQ-1","minimum":9007199254740992}]}','{"requirements":[{"id":"REQ-1","minimum":9007199254740993}]}');assert.equal(evaluate(left,right,'procurement').status,'rejected');
});
test('optional Python content oracle compares full unchanged/general/procurement output',{skip:process.env.JSTACK_ORACLE!=='1'},t=>{
  for(const [before,after,mode] of [['값 3개를 보존한다.','값 3개를 유지한다.','general'],['Same 2','Same 2','general'],['{"requirements":[{"id":"REQ-1","minimum":1}]}','{"requirements":[{"id":"REQ-1","minimum":1.0}]}','procurement'],['{"requirements":[{"id":"REQ-1","minimum":20}]}','{"requirements":[{"id":"REQ-1","minimum":21}]}','procurement']]){
    const {left,right}=fixture(t,before!,after!);const result=spawnSync('python3',['scripts/content_contract.py','--before',left,'--after',right,'--mode',mode!,'--json'],{encoding:'utf8'});assert.ok([0,1,2].includes(result.status!));assert.deepEqual(evaluate(left,right,mode),JSON.parse(result.stdout));
  }
});
