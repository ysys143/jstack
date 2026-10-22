/** Owning contracts for maintenance branches and native command adapters. */
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {check_contract_coverage,split_frontmatter} from '../../../../_suite_lib.js';
const file=fileURLToPath(import.meta.url), root=dirname(dirname(file));
let total=0,failed=0;
function check(name:string,ok:unknown){total++;if(!ok)failed++;console.log(`[${ok?'PASS':'FAIL'}] ${name}`);}
const read=(path:string)=>existsSync(path)?readFileSync(path,'utf8'):'';
const contracts:Record<string,string[]>={
  "SKILL.md": [
    "The executing harness does not select the storage format",
    "[Claude migration]",
    "[Codex migration]",
    "Do not create five extra skills",
    "Discovery is not permission",
    "Plan, review, apply, verify",
    "Ordinary recall searches must not mutate"
  ],
  "references/profile.md": [
    "Never source a marker",
    "conflicting duplicate",
    "before any write",
    "current running process",
    "Custom homes need not",
    "Private helper names"
  ],
  "references/claude-migration.md": [
    "--host claude",
    "--source-data-dir",
    "--receipt",
    "Changed input requires a new plan",
    "postfix evidence",
    "does not implement",
    "does not set up memory exports"
  ],
  "references/codex-migration.md": [
    "--host codex",
    "compatible initialized schemas",
    "subagent identity",
    "--receipt",
    "Divergent same-ID",
    "does not implement",
    "does not set up memory exports"
  ],
  "references/project-rename.md": [
    "global sed",
    "historical messages",
    "git rev-parse --git-dir",
    "Unknown formats stay unresolved",
    "not a binding",
    "Do not move"
  ],
  "references/plugin-cleanup.md": [
    "missing registry alone does not",
    "only the exact key",
    "disabled false entries",
    "A hash check is not a lock",
    "other profiles does not authorize",
    "file edit alone"
  ],
  "NOTICE": [
    "owner's explicit request",
    "license class: none",
    "not imported",
    "single execution engine"
  ]
};
for(const [rel,needles] of Object.entries(contracts)) {
 const raw=read(join(root,rel)),body=rel==='SKILL.md'?split_frontmatter(raw)[1]:raw;
 for(const needle of needles)check(`${rel}: ${needle}`,body.includes(needle));
}
const commands:Record<string,string>={
 'claude-profile':'profile','migrate-project-sessions':'claude-migration',
 'codex-migrate-project-sessions':'codex-migration','claude-project-rename':'project-rename',
 'claude-plugin-ghost-entry-cleanup':'plugin-cleanup'};
for(const [name,branch] of Object.entries(commands)) {
 const text=read(join(root,'../../commands',name+'.md'));
 check(`/${name} keeps arguments`,text.includes('$ARGUMENTS'));
 check(`/${name} uses common contract`,text.includes('/skills/agent-maintenance/SKILL.md'));
 check(`/${name} selects its branch`,text.includes(`/references/${branch}.md`));
 check(`/${name} does not inline five branches`,Object.values(commands).filter(b=>text.includes(`/references/${b}.md`)).length===1);
}
for(const host of ['claude','codex']) {
 const text=read(join(root,`references/${host}-migration.md`));
 check(`${host} uses existing migration engine`,text.includes('/skills/recall/scripts/migrate_sessions.js'));
 check(`${host} plan precedes apply`,text.indexOf(' plan ')>=0 && text.indexOf(' plan ')<text.indexOf(' apply '));
}
check_contract_coverage(check,file,root,{per_file:Object.fromEntries(Object.entries(contracts).map(([name,needles])=>[name,needles.length]))});
console.log(`\n${total-failed}/${total} 통과`);process.exitCode=failed?1:0;
