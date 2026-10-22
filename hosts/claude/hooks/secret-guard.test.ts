import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectSecretOutput} from './secret-guard.js';

const posixOnly={skip:process.platform==='win32'};

test('synthetic environment values never escape direct, linked, search and shell denials',posixOnly,t=>{
  const cwd=mkdtempSync(join(tmpdir(),'jstack-secret-guard-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const secret='SYNTHETIC-ONLY-SECRET-291';writeFileSync(join(cwd,'.env'),`TOKEN="first\n${secret}"\n`);symlinkSync('.env',join(cwd,'neutral'));linkSync(join(cwd,'.env'),join(cwd,'hardlink'));writeFileSync(join(cwd,'ordinary.txt'),'safe');writeFileSync(join(cwd,'.env.example'),'# template\nTOKEN=\n');
  for(const request of [
    {tool_name:'Read',tool_input:{file_path:'.env'}},{tool_name:'Read',tool_input:{file_path:join(cwd,'.env')}},
    {tool_name:'Read',tool_input:{file_path:'neutral'}},{tool_name:'Read',tool_input:{file_path:'hardlink'}},
    {tool_name:'Grep',tool_input:{path:cwd}},
    ...['cat .env','cat neutral','cat hardlink','rg TOKEN .','cat .env # ALLOW_ENV','python -c "print(open(\'.env\').read())"'].map(command=>({tool_name:'Bash',tool_input:{command}})),
  ]){
    const result=inspectSecretOutput({...request,cwd});assert.equal(result?.hookSpecificOutput.permissionDecision,'deny',JSON.stringify(request));assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));assert.match(result!.hookSpecificOutput.permissionDecisionReason,/Exceptions are unsupported/);assert.match(result!.hookSpecificOutput.permissionDecisionReason,/unregistered jstack candidate/);assert.doesNotMatch(result!.hookSpecificOutput.permissionDecisionReason,/Registration is/);
  }
  for(const request of [{tool_name:'Read',tool_input:{file_path:'ordinary.txt'}},{tool_name:'Read',tool_input:{file_path:'.env.example'}},{tool_name:'Bash',tool_input:{command:'python app.py'}},{tool_name:'Bash',tool_input:{command:'curl -H "Authorization: Bearer $API_TOKEN" https://example.invalid'}}])assert.equal(inspectSecretOutput({...request,cwd}),undefined);
  writeFileSync(join(cwd,'.env.example'),'TOKEN=not-an-empty-template');assert.equal(inspectSecretOutput({cwd,tool_name:'Read',tool_input:{file_path:'.env.example'}})?.hookSpecificOutput.permissionDecision,'deny');
});
test('invalid guard input produces sanitized deny JSON instead of fail-open output',()=>{
  for(const input of ['{broken','null',JSON.stringify({tool_name:'Read',tool_input:{file_path:42}})]){
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./secret-guard.js',import.meta.url))],{input,encoding:'utf8'});
    assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,'deny');
  }
});
