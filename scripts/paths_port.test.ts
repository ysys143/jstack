import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {checkPluginPaths} from './check_plugin_paths.js';
import {checkPathsRegression,parseMiss} from './check_paths_regression.js';
import * as builder from '../packaging/build.js';
function fixture(t:any){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jstack-paths-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const write=(rel:string,text:string)=>{const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};return {root,write};}
test('routing synthetic paths are exempt only in their documented producers',t=>{
  const {root,write}=fixture(t);
  write('runtime/ROUTING.md','Evidence: /absolute/check-output.txt');
  write('scripts/routing_eval.js','const fixture="./calc.cjs";');
  assert.equal(checkPluginPaths(root).code,0);
  write('scripts/production.js','const missing="./calc.cjs";');
  assert.ok(checkPluginPaths(root).misses.some(([ref,source])=>ref==='calc.cjs'&&source==='scripts/production.js'));
  write('scripts/routing_eval.js','import missing from "./missing-runtime.js";');
  assert.ok(checkPluginPaths(root).misses.some(([ref,source])=>ref==='missing-runtime.js'&&source==='scripts/routing_eval.js'));
});
test('path checker measures fenced references, root variables, Windows paths and compiled JS files',t=>{
  const {root,write}=fixture(t);write('skills/a/SKILL.md','${JSTACK_PLUGIN_ROOT}/scripts/live.js\n```sh\nnode scripts/missing.js\n```\n$env:JSTACK_ROOT\\scripts\\windows.js\n자료/결과.md\n`/hello`\n');
  write('scripts/live.js','');write('scripts/windows.js','');write('자료/결과.md','');write('commands/hello.md','');const result=checkPluginPaths(root);
  assert.equal(result.total,4);assert.deepEqual(result.misses,[['scripts/missing.js','skills/a/SKILL.md']]);assert.equal(result.code,1);
  write('scripts/missing.js','');assert.equal(checkPluginPaths(root).code,0);
});
test('reviewed exclusions stay source scoped and missing slash commands remain visible',t=>{
  const {root,write}=fixture(t);write('skills/proof/references/character-count.md','input.txt\n');write('skills/a/SKILL.md','references/anthropic-skills-guide/02-planning-and-design.md\n`/missing-command`');
  const result=checkPluginPaths(root);assert.ok(result.misses.some(([ref])=>ref.includes('anthropic-skills-guide')));assert.match(result.lines.join('\n'),/\/missing-command/);
});
test('fixture paths are exempt in test sources and the shared model-check case module only',t=>{
  const {root,write}=fixture(t);
  write('hooks/model-versions-bash.test.js','const node="tests/test_chat.py";');write('hooks/_model-versions-cases.js','const node="tests/test_chat.py";');
  assert.equal(checkPluginPaths(root).code,0);
  write('hooks/_other-cases.js','const node="tests/test_chat.py";');
  assert.ok(checkPluginPaths(root).misses.some(([ref,source])=>ref==='tests/test_chat.py'&&source==='hooks/_other-cases.js'));
});
test('stable release npm archive is ignored only as a README download artifact',t=>{
  const {root,write}=fixture(t);
  write('README.md','npm install -g ./ysys143-jstack-0.9.7.tgz');
  assert.equal(checkPluginPaths(root).code,0);
  write('skills/a/SKILL.md','npm install -g ./ysys143-jstack-0.9.7.tgz');
  assert.ok(checkPluginPaths(root).misses.some(([ref,source])=>ref==='ysys143-jstack-0.9.7.tgz'&&source==='skills/a/SKILL.md'));
});
test('native source scanning ignores regex syntax and URLs while measuring real missing imports',t=>{
  const {root,write}=fixture(t);
  write('scripts/probe.js', 'const a=/auth/i.test(value); const remote="https://example.invalid/no/file.json"; const file="scripts/missing.js";');
  const result=checkPluginPaths(root);
  assert.deepEqual(result.misses,[['scripts/missing.js','scripts/probe.js']]);
  write('scripts/missing.js','export {};');assert.equal(checkPluginPaths(root).code,0);
});
test('TypeScript import resolution and scoped external examples do not excuse a product document',t=>{
  const {root,write}=fixture(t);
  write('skills/a/scripts/main.ts','import value from "./helper.js";');write('skills/a/scripts/helper.ts','export default 1;');
  write('skills/deepagents/references/api.md','Read ./subagents.yaml');assert.equal(checkPluginPaths(root).code,0);
  write('skills/a/SKILL.md','Read ./subagents.yaml');assert.ok(checkPluginPaths(root).misses.some(([ref,source])=>ref==='subagents.yaml'&&source==='skills/a/SKILL.md'));
});
test('regression rejects checker disappearance, crash, empty output, zero measured refs and hygiene',t=>{
  const {root,write}=fixture(t);write('tests/fixtures/path-reference-baseline.txt','## jstack\n');write('checker.js','fixture');const checker=path.join(root,'checker.js');
  for(const result of [{status:0,stdout:'',stderr:''},{status:2,stdout:'',stderr:'Error: crashed'},{status:0,stdout:'참조 0건 / 실재 0건 / MISS 0건',stderr:''},{status:1,stdout:'참조 1건 / 실재 1건 / MISS 0건\n위생 위반 1건',stderr:''}])assert.equal(checkPathsRegression({root,checker,run:()=>result}).code,2);
  assert.equal(checkPathsRegression({root,checker:path.join(root,'absent')}).code,2);
});
test('regression keeps the zero-new-miss ceiling and preserves reference/source pairing',t=>{
  const {root,write}=fixture(t);const miss='  scripts/gone.js\n    <- skills/a/SKILL.md';write('tests/fixtures/path-reference-baseline.txt','## jstack\n'+miss);write('checker.js','fixture');const checker=path.join(root,'checker.js');
  const output='참조 2건 / 실재 1건 / MISS 1건\nMISS:\n'+miss;assert.equal(parseMiss(output).size,1);assert.equal(checkPathsRegression({root,checker,run:()=>({status:1,stdout:output,stderr:''})}).code,0);
  const changed=output+'\n  scripts/new.js\n    <- skills/a/SKILL.md';assert.equal(checkPathsRegression({root,checker,run:()=>({status:1,stdout:changed,stderr:''})}).code,1);
});


test('user state, built-in host commands and provenance exclusions stay with their owners', t => {
  const {root,write}=fixture(t);
  const cases = [
    ['README.md','.agents/plugins/marketplace.json\n`/plugin`'],
    ['skills/disk-manager/references/installation.md','state/disk-manager/history.sqlite3'],
    ['skills/agent-maintenance/source-provenance.json','references/claude-profile.md'],
    ['skills/agent-maintenance/references/codex-migration.md','/private/new-migration-plan.json'],
    ['skills/dashboard/SKILL.codex.md','CODEX_HOME/config.toml\n`/statusline`'],
    ['skills/setup/references/comment-convention-governance.md','rules/comment-intent.js'],
  ];
  for (const [file,body] of cases) write(file!,body!);
  assert.equal(checkPluginPaths(root).code,0);
  write('skills/unrelated/SKILL.md',cases.map(([,body])=>body).join('\n'));
  const bad=checkPluginPaths(root);
  assert.equal(bad.code,1);
  assert.ok(bad.misses.length >= cases.length);
  assert.match(bad.lines.join('\n'),/statusline/);
});

test('contributor references resolve logical owners into canonical sources without hiding absent files', t => {
  const {root,write}=fixture(t);
  write('runtime/contracts/ts-migration/fixture.json','skills/a/scripts/check.py');
  write('source/contracts/skill-catalog.json',JSON.stringify({entries:[{owner:'a',name:'review',visibility:'public',category:'workflow'}]}));
  write('source/skills/public/workflow/review/scripts/check.py','pass');
  assert.equal(checkPluginPaths(path.join(root,'runtime'),path.join(root,'source')).code,0);
  fs.unlinkSync(path.join(root,'source/skills/public/workflow/review/scripts/check.py'));
  assert.equal(checkPluginPaths(path.join(root,'runtime'),path.join(root,'source')).code,1);
});

test('canonical skill references transform only reviewed package members', () => {
  const transform = (builder as any).runtimeSkillReferences;
  assert.equal(typeof transform, 'function');
  const membership = {schemaVersion: 1, files: [{source: 'skills/public/workflow/verify/references/self-check.md', target: 'skills/verify/references/self-check.md'}]};
  const source = 'skills/public/workflow/verify/references/self-check.md';
  assert.equal(transform(`[review](${source}#termination)`, membership), '[review](skills/verify/references/self-check.md#termination)');
  assert.equal(transform('skills/public/workflow/verify/references/absent.md', membership), 'skills/public/workflow/verify/references/absent.md');
  assert.equal(transform(`https://example.invalid/${source}`, membership), `https://example.invalid/${source}`);
});

test('unbraced root variables and documented release paths require real shipped scripts', t => {
  const {root,write}=fixture(t);
  write('payload/skills/tdd/references/test-budget.md', 'node "$JSTACK_PLUGIN_ROOT/skills/verify/scripts/test_profile.js"');
  write('payload/skills/verify/scripts/test_profile.js', '');
  write('payload/README.md', 'node <extracted>/plugins/jstack/payload/skills/host-audit/scripts/main.js');
  write('payload/skills/host-audit/SKILL.md', 'node <extracted>/jstack-marketplace/plugins/jstack/payload/skills/host-audit/scripts/main.js');
  write('payload/skills/host-audit/scripts/main.js', '');
  const check=()=>checkPluginPaths(path.join(root,'payload'), undefined, root);
  assert.equal(check().code,0);
  write('payload/skills/other/SKILL.md','node /plugins/jstack/payload/skills/host-audit/scripts/main.js');
  assert.ok(check().misses.some(([,src])=>src==='skills/other/SKILL.md'));
  fs.unlinkSync(path.join(root,'payload/skills/other/SKILL.md'));
  fs.unlinkSync(path.join(root,'payload/skills/host-audit/scripts/main.js'));
  assert.equal(check().misses.filter(([ref])=>ref.endsWith('host-audit/scripts/main.js')).length,2);
  fs.unlinkSync(path.join(root,'payload/skills/verify/scripts/test_profile.js'));
  assert.ok(check().misses.some(([ref])=>ref==='skills/verify/scripts/test_profile.js'));
});

test('documented caller examples and historical host observations stay source scoped', t => {
  const {root,write}=fixture(t);
  const cases=[
    ['skills/setup/references/testing-guidance.md','path/to/file.test.ts\n/tmp/test.log\ntest/quarantine.txt'],
    ['skills/verify/references/flaky-tests.md','path/to/new.test.ts\npath/to/new.test.js\ntests/test_new.py'],
    ['skills/verify/references/test-parallelism.md','test/test_helper.rb'],
    ['skills/verify/references/self-check.md','tests/session.test.ts'],
    ['hooks/CONTRACT.md','docs/CHANGELOG.md'],
    ['runtime/review-cycles.upstream.md','internal/detect/engine.go'],
    ['skills/host-audit/references/host-rules.md','r11/workflow/plan/SKILL.md\ndocs/skill-routing-principles-20260915.md'],
  ];
  for(const[file,body]of cases)write(file!,body!);
  assert.equal(checkPluginPaths(root).code,0);
  write('skills/other/SKILL.md',cases.map(([,body])=>body).join('\n'));
  assert.equal(checkPluginPaths(root).misses.length,12);
});

test('host-audit contributor annotations resolve actual source files and fail after removal', t => {
  const {root,write}=fixture(t);
  write('payload/skills/host-audit/references/host-rules.md','scripts/analyze.ts\ndist/skills/support/host-audit/tests/rules.test.js');
  write('payload/runtime/review-cycles.upstream.md','runtime/review_cycles.ts');
  write('source/contracts/skill-catalog.json',JSON.stringify({entries:[{owner:'host-audit',name:'host-audit',visibility:'support'}]}));
  write('source/skills/public/workflow/example/SKILL.md','');
  write('source/skills/support/host-audit/scripts/analyze.ts','');
  write('source/dist/skills/support/host-audit/tests/rules.test.js','');
  write('source/runtime/review_cycles.ts','');
  const check=()=>checkPluginPaths(path.join(root,'payload'),path.join(root,'source'));
  assert.equal(check().code,0);
  fs.unlinkSync(path.join(root,'source/skills/support/host-audit/scripts/analyze.ts'));
  assert.ok(check().misses.some(([ref])=>ref==='scripts/analyze.ts'));
});

test('comment examples do not exempt imports or executable strings', t => {
  const {root,write}=fixture(t);
  write('skills/host-audit/scripts/inventory.js','// Two plugins use hooks-handlers/session-start.sh\n');
  write('skills/host-audit/scripts/analyze.js','// Codex lists r11/workflow/plan/SKILL.md\n');
  assert.equal(checkPluginPaths(root).code,0);
  write('skills/host-audit/scripts/inventory.js','import x from "hooks-handlers/session-start.sh";');
  write('skills/host-audit/scripts/analyze.js','const input="r11/workflow/plan/SKILL.md";');
  assert.equal(checkPluginPaths(root).misses.length,2);
});

test('SDLC activation tokens are accepted only in their owning procedure and contract', t => {
  const {root,write}=fixture(t);
  for(const file of ['contracts/sdlc.md','skills/sdlc/SKILL.md','skills/sdlc/references/run-protocol.md'])write(file,'Start with `/sdlc`');
  assert.equal(checkPluginPaths(root).code,0);
  write('skills/other/SKILL.md','Start with `/sdlc`');
  const result=checkPluginPaths(root);
  assert.equal(result.code,1);
  assert.match(result.lines.join('\n'),/\/sdlc\n\s+<- skills\/other\/SKILL\.md/);
});
