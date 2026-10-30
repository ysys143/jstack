import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {checkAttribution} from './check_attribution.js';
import {checkCost, toks, descriptions, BUDGET} from './check_cost.js';
import {checkHookOrder} from './check_hook_order.js';
import {checkSpecRefs} from './check_spec_refs.js';
import {check as canonical, CANONICAL} from './check_suite_lib_parity.js';
import {yamlTags} from './eval_tags.js';
function fixture(t: any) {const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jstack-checks-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const write=(rel:string,text:string)=>{const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};return {root,write};}
test('tag parser preserves inline/block/comment semantics and leaves unrelated lists alone',()=>{
  assert.deepEqual(yamlTags("tags: ['one', two] # ignored\nother: x\n  - no\ntags:\n  - 'three'\n\n # note\n  - four\nend: yes\n - ignored"),['one','two','three','four']);
});
test('cost counts Unicode codepoints, folded descriptions, largest host and every shipped byte',t=>{
  const {root,write}=fixture(t);write('payload/commands/c.md','---\ndescription: >\n  first line\n  next line\nname: c\n---\n');
  write('entries/claude/s/SKILL.md','---\ndescription: short\n---\n');write('entries/codex/s/SKILL.md','---\ndescription: '+ 'x'.repeat(100)+'\n---\n');
  write('extra.bin','123456789');write('node_modules/ignored','ignored');
  assert.equal(toks('가😀abc'),2);assert.equal(descriptions(path.join(root,'payload'))[0]![2],toks('>\n  first line\n  next line'));
  const result=checkCost(root);assert.equal(result.out.jstack.always_on_tokens,25);assert.equal(result.code,0);
  write('entries/codex/s/SKILL.md','---\ndescription: '+'x'.repeat(BUDGET.jstack.always_on_tokens*4+4)+'\n---\n');assert.equal(checkCost(root).code,1);
});
test('attribution checks declaration set, section bounds and license independently',t=>{
  const {root,write}=fixture(t);write('hosts/claude/output-styles/fluent-korean.md','## Sentence level\n1. Rule\n');write('hosts/claude/output-styles/fluent-korean-not-coding.md','style');
  write('hosts/claude/output-styles/ATTRIBUTION.md','MIT License\nWITHOUT WARRANTY');
  const tax='> fluent-korean ported A-1 (rule)\n### A-1. fluent-korean port\nsnflkd/fluent-korean\noutput-style sentence-level-1\n';
  write('skills/humanize/references/ai-tell-taxonomy.md',tax);assert.equal(checkAttribution(root).code,0);
  // The same contract must work from the canonical contributor hierarchy.
  write('contracts/skill-catalog.json', JSON.stringify({entries:[{owner:'humanize',name:'humanize',visibility:'public',category:'artifacts'}]}));
  fs.mkdirSync(path.join(root,'skills/public/artifacts'),{recursive:true});
  fs.renameSync(path.join(root,'skills/humanize'),path.join(root,'skills/public/artifacts/humanize'));
  assert.equal(checkAttribution(root).code,0);

  write('skills/public/artifacts/humanize/references/ai-tell-taxonomy.md',tax.replace('sentence-level-1','sentence-level-2'));assert.match(checkAttribution(root).problems.join('\n'),/invalid section/);
  write('hosts/claude/output-styles/ATTRIBUTION.md','MIT License');assert.match(checkAttribution(root).problems.join('\n'),/license/);
});
test('hook checker rejects reordered chains, wrong matchers, and undocumented events',t=>{
  const {root,write}=fixture(t);const expected={'hooks/hooks.json':{PreToolUse:['a.js','b.js'],Stop:[]}};
  const hooks={hooks:{PreToolUse:[{matcher:'Edit|Write',hooks:[{command:'node "root/a.js"'},{command:'node "root/b.js"'}]}],Stop:[]}};
  write('hooks/hooks.json',JSON.stringify(hooks));write('hooks/CONTRACT.md','| 1 | `a.js` | `Edit\\|Write` |\n| 2 | `b.js` | `Edit\\|Write` |\n');assert.deepEqual(checkHookOrder(root,expected),[]);
  hooks.hooks.PreToolUse[0]!.hooks.reverse();write('hooks/hooks.json',JSON.stringify(hooks));assert.match(checkHookOrder(root,expected).join('\n'),/order mismatch/);
  write('hooks/CONTRACT.md','| 1 | `a.js` | `Bash` |\n| 2 | `b.js` | `Edit\\|Write` |\n');assert.match(checkHookOrder(root,expected).join('\n'),/matcher mismatch/);
});
test('line citations require at least one measurable source and count final unterminated line',t=>{
  const {root,write}=fixture(t);write('skills/a/SKILL.md','See target.md:99');assert.equal(checkSpecRefs(root).code,1);
  write('skills/a/references/target.md','one\ntwo');write('skills/a/SKILL.md','See references/target.md:2');assert.equal(checkSpecRefs(root).code,0);
  write('skills/a/SKILL.md','See references/target.md:2-3');assert.equal(checkSpecRefs(root).bad.length,1);
  write('contracts/skill-catalog.json', JSON.stringify({entries:[{owner:'a',name:'review',visibility:'public',category:'workflow'}]}));
  fs.mkdirSync(path.join(root,'skills/public/workflow'),{recursive:true});
  fs.renameSync(path.join(root,'skills/a'),path.join(root,'skills/public/workflow/review'));
  assert.equal(checkSpecRefs(root).bad.length,1);
  write('skills/public/workflow/review/SKILL.md','See skills/a/references/target.md:2');
  assert.equal(checkSpecRefs(root).code,0);

});
test('canonical membership detects duplicate bindings, duplicate library and retired trees',t=>{
  const {root,write}=fixture(t);const rows=Object.entries(CANONICAL).map(([source,target])=>({source,target}));
  for(const [source]of Object.entries(CANONICAL))write(source,'fixture');write('packaging/package-files.json',JSON.stringify({files:rows}));assert.deepEqual(canonical(root),[]);
  write('packaging/package-files.json',JSON.stringify({files:[...rows,rows[0]]}));write('skills/other/_suite_lib.py','duplicate');fs.mkdirSync(path.join(root,'staging'));
  assert.equal(canonical(root).length,3);
});
