import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {checkSuiteLibBehaviour} from './check_suite_lib_behaviour.js';
test('behaviour checker executes all nine controls against the actual compiled shared library',async()=>{const result=await checkSuiteLibBehaviour();assert.equal(result.code,0,result.lines.join('\n'));assert.equal(result.results.length,9);});
test('missing shared library fails instead of substituting another implementation',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'jstack-no-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const result=await checkSuiteLibBehaviour(root);assert.equal(result.code,2);assert.match(result.lines.join('\n'),/missing/);});
