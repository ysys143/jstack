import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {joinCommand} from '../scripts/red_probe.js';
import {context,capture,assess,status} from '../../../../../runtime/task_state.js';
const cli=fileURLToPath(new URL('../scripts/workflow.js',import.meta.url));
function setup(t:any){const root=fs.mkdtempSync(path.join(os.tmpdir(),'jstack-workflow-ts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const put=(name:string,value:string)=>fs.writeFileSync(path.join(root,name),value);const call=(program:string,args:string[],code=0)=>{const run=spawnSync(program,args,{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});assert.equal(run.status,code,run.stdout+run.stderr);return run.stdout;};call('git',['init','-q']);put('app.cjs','module.exports=(a,b)=>a-b;');put('check.cjs',"require('assert').equal(require('./app.cjs')(2,3),5)");put('red.cjs',"const fs=require('fs'),path=require('path'),cp=require('child_process');const root=process.argv[2];fs.writeFileSync(path.join(root,'app.cjs'),'module.exports=()=>0;');const run=cp.spawnSync(process.execPath,['check.cjs'],{cwd:root});process.exit(run.status!==0?0:1)");const command=(...args:string[])=>joinCommand(['node',...args]);const contract:any={'계약버전':2,'작업ID':'bug-1','발동':'사용자','위임':'필요','준비':[{'도구':'node','확인명령':command('--version')}],'산출':[{'경로':'app.cjs','형식':'JavaScript'}],'검증':[{'요구ID':'ADD-1','사용자행동':'return the sum','관련파일':['app.cjs','check.cjs','red.cjs'],'등급':'기계','명령':{'실행':command('check.cjs'),'기대종료':0},'반증':{'실행':command('red.cjs','{RED_ROOT}'),'기대종료':0},'인간검토':'불필요','추가검토':[{'종류':'cold-read','적용':'필요'}]}]};put('contract.yaml',JSON.stringify(contract));call('git',['add','.']);call('git',['-c','user.name=Test','-c','user.email=validation@example.invalid','commit','-qm','base']);const workflow=(action:string,args:string[]=[],code=0)=>JSON.parse(call(process.execPath,[cli,action,'bug-1',...args],code));const ready=()=>{workflow('init',['contract.yaml']);workflow('preflight');workflow('brief');};const review=()=>{put('review.txt','Cold read reviewed ADD-1 and all three target files.');workflow('record-review',['ADD-1','cold-read','--raw-output','review.txt','--verdict','pass']);};return {root,put,workflow,ready,review,contract};}
test('full task binds review, preserves RED source, resumes evidence, and detects stale target',t=>{const f=setup(t);f.ready();f.put('app.cjs','module.exports=(a,b)=>a+b;');assert.equal(f.workflow('verify',[],1).verified,false);f.put('cursor.txt','app.cjs');f.workflow('interrupt',['--cursor-file','cursor.txt','--evidence','app.cjs']);assert.equal(f.workflow('resume').resumed,true);f.review();assert.equal(f.workflow('verify').verified,true);assert.equal(fs.readFileSync(path.join(f.root,'app.cjs'),'utf8'),'module.exports=(a,b)=>a+b;');assert.equal(f.workflow('status').complete,true);f.put('app.cjs','module.exports=(a,b)=>a-b;');assert.ok(f.workflow('status',[],1).problems.includes('target-stale'));});
test('resume refuses changed cursor and status refuses modified review or receipt',t=>{const f=setup(t);f.ready();f.put('cursor.txt','original');f.workflow('interrupt',['--cursor-file','cursor.txt']);f.put('cursor.txt','changed');assert.equal(f.workflow('resume',[],1).resumed,false);f.put('cursor.txt','original');f.workflow('resume');f.put('app.cjs','module.exports=(a,b)=>a+b;');f.review();f.workflow('verify');f.put('review.txt','altered review');assert.ok(f.workflow('status',[],1).problems.some((p:string)=>p.startsWith('review-stale:')));});
test('request assessment references the original workflow and rejects stale code evidence',t=>{
 const f=setup(t);f.ready();
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'.jstack/tasks/bug-1/state.json'),'utf8')).phase,'briefed','preparation is not observed execution');
 f.put('app.cjs','module.exports=(a,b)=>a+b;');f.review();f.workflow('verify');
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jstack-request-home-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const c=context(f.root,home);capture(c,{id:'request',expectedRevision:0,purpose:'Fix addition',source:{role:'user',message:'turn-1',quote:'Fix addition'},requirements:[{id:'ADD',text:'Return the sum',kind:'code'}]});
 const evidence={requirement:'ADD',requirementRevision:1,method:'workflow',result:'pass',rationale:'ADD-1 verifies the requested sum behavior',artifacts:['app.cjs'],observer:'workflow',workflow:{cwd:fs.realpathSync(f.root),task:'bug-1',requirement:'ADD-1'}};
 assert.throws(()=>assess(c,{id:'request',expectedRevision:1,evidence:[{...evidence,workflow:{...evidence.workflow,requirement:'unrelated'}}]}),/not verified/);
 const task=assess(c,{id:'request',expectedRevision:1,evidence:[evidence]});assert.equal(status(c,task).complete,true);
 f.put('check.cjs','throw Error("changed verifier")');assert.equal(status(c,task).complete,false);
});
test('a fresh failed workflow records failure without turning it into missing or passing evidence',t=>{
 const f=setup(t);f.contract['검증'][0]['추가검토']=[];f.put('contract.yaml',JSON.stringify(f.contract));f.ready();f.workflow('verify',[],1);
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jstack-failed-home-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const c=context(f.root,home);capture(c,{id:'request',expectedRevision:0,purpose:'Fix addition',source:{role:'user',message:'turn-1',quote:'Fix addition'},requirements:[{id:'ADD',text:'Return the sum',kind:'code'}]});
 const evidence={requirement:'ADD',requirementRevision:1,method:'workflow',result:'fail',rationale:'The current sum check fails',artifacts:['app.cjs'],observer:'workflow',workflow:{cwd:fs.realpathSync(f.root),task:'bug-1',requirement:'ADD-1'}};
 const task=assess(c,{id:'request',expectedRevision:1,evidence:[evidence]});const view=status(c,task);assert.equal(view.complete,false);assert.equal(view.requirements[0]!.state,'failed');
 assert.throws(()=>assess(c,{id:'request',expectedRevision:2,evidence:[{...evidence,result:'pass'}]}),/failed or stale/);
});
test('workflow timeout kills a running child process and records the timeout receipt',async t=>{
 const f=setup(t);
 // Allow process startup under concurrent suites; still require the child to
 // start and prove that timeout prevents its later side effect.
 const child="const fs=require('node:fs');fs.writeFileSync('child-started',String(process.pid));setTimeout(()=>fs.writeFileSync('child-marker','late'),12000);";
 f.put('hang.cjs',`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setTimeout(()=>{},30000);`);
 f.contract['검증'][0]['추가검토']=[];
 f.contract['검증'][0]['관련파일'].push('hang.cjs');
 f.contract['검증'][0]['명령']['실행']=joinCommand(['node','hang.cjs']);
 f.put('contract.yaml',JSON.stringify(f.contract));
 const committed=spawnSync('git',['-c','user.name=Test','-c','user.email=validation@example.invalid','add','contract.yaml','hang.cjs'],{cwd:f.root,encoding:'utf8'});assert.equal(committed.status,0,committed.stderr);
 const commit=spawnSync('git',['-c','user.name=Test','-c','user.email=validation@example.invalid','commit','-qm','test timeout contract'],{cwd:f.root,encoding:'utf8'});assert.equal(commit.status,0,commit.stderr);
 f.ready();f.put('app.cjs','module.exports=(a,b)=>a+b;');
 const result=f.workflow('verify',['--timeout-seconds','5'],1);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.root,result.receipt),'utf8'));
 assert.equal(receipt.requirements[0].positive.timedOut,true);
 assert.equal(receipt.requirements[0].positive.exitCode,124);
 assert.equal(fs.existsSync(path.join(f.root,'child-started')),true,'the child must actually have started');
 // Wait for the condition, not the clock: the descendant must stop existing, which
 // also rules out its delayed write, instead of sleeping past the 12-second write.
 const pid=Number(fs.readFileSync(path.join(f.root,'child-started'),'utf8'));
 assert.ok(Number.isInteger(pid)&&pid>0,'the child must record its pid');
 const alive=()=>{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}};
 const deadline=Date.now()+10000;
 while(alive()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(alive(),false,'the timeout must terminate the descendant process');
 assert.equal(fs.existsSync(path.join(f.root,'child-marker')),false);
});
