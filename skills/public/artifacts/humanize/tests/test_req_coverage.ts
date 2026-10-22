/** Preserve all seven deterministic requirement-ID coverage counterexamples. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../../../../../runtime/os.js';
const here=dirname(fileURLToPath(import.meta.url)),script=join(here,'../scripts/req_coverage.js'),fixtures=join(here,'fixtures/req_coverage'),requirements=join(fixtures,'reqs.txt');
const run=(proposal:string,options:string[]=[],req=requirements)=>runProcess(process.execPath,[script,'--requirements',req,'--proposal',join(fixtures,proposal),...options]);
test('full requirement coverage returns zero',()=>{const r=run('proposal_full.md',['--json']);assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.coverage,1);assert.equal(value.missing,0);});
test('missing requirement returns one and names it',()=>{const r=run('proposal_missing.md',['--json']);assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/SFR-003/);});
test('SFR-0011 does not count as SFR-001',()=>{const r=run('proposal_boundary.md',['--json']);assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/"SFR-001":\s*0/);});
test('missing requirements file returns two',()=>{const r=run('proposal_full.md',[],join(fixtures,'does_not_exist.txt'));assert.equal(r.status,2,r.stderr);});
test('missing proposal file returns two',()=>{const r=run('does_not_exist.md');assert.equal(r.status,2,r.stderr);});
test('complete human-readable output retains totals and verdict',()=>{const r=run('proposal_full.md');assert.equal(r.status,0,r.stderr);for(const text of ['Requirements 5','covered 5','missing 0','coverage 100.0%','No missing requirements'])assert.ok(r.stdout.includes(text),text);});
test('incomplete human-readable output names missing requirements',()=>{const r=run('proposal_missing.md');assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/Missing:/);assert.match(r.stdout,/SFR-003/);});
