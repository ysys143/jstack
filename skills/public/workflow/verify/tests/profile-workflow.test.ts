import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {profile_gaps,run_selected,render_evidence} from '../scripts/workflow.js';

const req=(checks:any[])=>({'요구ID':'R1','관련파일':['a.js'],'명령':{'실행':'node t.js','기대종료':0},'반증':{'실행':'node r.js {RED_ROOT}','기대종료':0},'추가검사':checks});
const repoWith=(profile?:any)=>{const repo=fs.mkdtempSync(path.join(os.tmpdir(),'jstack-profile-'));fs.writeFileSync(path.join(repo,'probe.js'),"process.exit(Number(process.argv[2]==='a.js'?process.env.PROBE_RC??0:9));\n");if(profile){fs.mkdirSync(path.join(repo,'.jstack'));fs.writeFileSync(path.join(repo,'.jstack','verification.json'),JSON.stringify(profile));}return repo;};

test('a contract that selects no optional check needs no profile',()=>{
  const repo=repoWith();
  try{assert.deepEqual(profile_gaps(repo,{'검증':[req([{'종류':'mutation','적용':'생략','생략사유':'x'}])]}),[]);}finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('a selected check the profile does not declare is a preflight gap',()=>{
  const repo=repoWith({schemaVersion:1,checks:{crap:{command:'node probe.js {FILES}'}}});
  try{assert.deepEqual(profile_gaps(repo,{'검증':[req([{'종류':'mutation','적용':'필요'}])]}),['R1: mutation is selected but .jstack/verification.json does not declare it']);}finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('a selected check runs over the requirement files and its mode decides the outcome',()=>{
  const repo=repoWith({schemaVersion:1,checks:{mutation:{command:'node probe.js {FILES}',mode:'fail'},duplication:{command:'node probe.js {FILES}'}}});
  const saved=process.env.PROBE_RC;process.env.PROBE_RC='1';
  try{
    const rows=run_selected(repo,req([{'종류':'mutation','적용':'필요'},{'종류':'duplication','적용':'필요'},{'종류':'crap','적용':'생략','생략사유':'x'}]));
    assert.deepEqual(rows.map(row=>[row.kind,row.outcome,row.exitCode]),[['mutation','failed',1],['duplication','reported',1]]);
  }finally{if(saved===undefined)delete process.env.PROBE_RC;else process.env.PROBE_RC=saved;fs.rmSync(repo,{recursive:true,force:true});}
});

test('author separation without a recorded brief is a gap',()=>{
  const repo=repoWith({schemaVersion:1,checks:{authorSplit:{}}});
  try{assert.equal(run_selected(repo,req([{'종류':'authorSplit','적용':'필요'}]))[0].outcome,'gap');}finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('evidence lists passed checks as verified and reported or failed ones as not verified',()=>{
  const contract={'검증':[req([{'종류':'crap','적용':'생략','생략사유':'one-line function'}])]};
  const receipt={requirements:[{requirementId:'R1',positive:{exitCode:0},negativeControl:{exitCode:0},passed:true}],extraChecks:[
    {requirementId:'R1',kind:'mutation',command:'stryker run',exitCode:0,outcome:'passed'},
    {requirementId:'R1',kind:'duplication',command:'jscpd',exitCode:1,outcome:'reported'},
    {requirementId:'R1',kind:'direction',command:'depcruise',exitCode:null,outcome:'gap',detail:'the declared tool depcruise is not installed'}]};
  const text=render_evidence('t',receipt,contract,[]).join('\n');
  assert.match(text,/Verified\n- R1: .*\n- R1 mutation check: `stryker run` exit 0/);
  assert.match(text,/- R1 crap check: skipped — one-line function/);
  assert.match(text,/- R1 duplication check: `jscpd` exit 1, reported only \(mode report\)/);
  assert.match(text,/- R1 direction check: `depcruise` gap — the declared tool depcruise is not installed/);
});

const gitRepo=(profile:any)=>{const repo=repoWith(profile),git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git('init','-q','-b','main');git('config','user.email','t@example.invalid');git('config','user.name','t');return {repo,git};};

test('a holdout must exist and stay untracked, or preflight reports a gap',()=>{
  const {repo,git}=gitRepo({schemaVersion:1,checks:{holdout:{dir:'hidden',command:'node {HOLDOUT}/h.js'}}});
  const contract={'검증':[req([{'종류':'holdout','적용':'필요'}])]};
  try{
    assert.match(profile_gaps(repo,contract)[0]!,/holdout directory hidden does not exist/);
    fs.mkdirSync(path.join(repo,'hidden'));fs.writeFileSync(path.join(repo,'hidden','h.js'),'process.exit(0);\n');
    assert.deepEqual(profile_gaps(repo,contract),[]);
    git('add','-A');git('commit','-qm','tracked');
    assert.match(profile_gaps(repo,contract)[0]!,/is tracked by git/);
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('the holdout command receives the holdout directory',()=>{
  const repo=repoWith({schemaVersion:1,checks:{holdout:{dir:'hidden',command:'node {HOLDOUT}/h.js'}}});
  try{fs.mkdirSync(path.join(repo,'hidden'));fs.writeFileSync(path.join(repo,'hidden','h.js'),'process.exit(3);\n');
    const [row]=run_selected(repo,req([{'종류':'holdout','적용':'필요'}]));
    assert.deepEqual([row.kind,row.exitCode,row.outcome],['holdout',3,'reported']);
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('author separation fails when the implementer changes the tests after the brief',()=>{
  const {repo,git}=gitRepo({schemaVersion:1,checks:{authorSplit:{mode:'fail'}}});
  const split=req([{'종류':'authorSplit','적용':'필요'}]);split['관련파일']=['a.js','tests/'];
  try{
    fs.mkdirSync(path.join(repo,'tests'));fs.writeFileSync(path.join(repo,'tests','a.test.js'),'expect(1).toBe(1);\n');git('add','-A');git('commit','-qm','tests');
    const baseline=git('rev-parse','HEAD');
    fs.writeFileSync(path.join(repo,'a.js'),'module.exports=1;\n');
    assert.equal(run_selected(repo,split,baseline)[0].outcome,'passed');
    fs.writeFileSync(path.join(repo,'tests','a.test.js'),'expect(1).toBeDefined();\n');
    const [row]=run_selected(repo,split,baseline);
    assert.equal(row.outcome,'failed');assert.match(row.detail,/tests\/a\.test\.js/);
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});
