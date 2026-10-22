#!/usr/bin/env node
/** Inspect the bundled model snapshot and author update notes; no online freshness claim. */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_MODELS, DEPRECATED_MODELS, DEPRECATED_PATTERNS, type ModelInfo } from './models_database.js';
import { isMain } from '../runtime/entry.js';
export function load_database() { return [CURRENT_MODELS,DEPRECATED_MODELS,DEPRECATED_PATTERNS] as const; }
export function detect_stale_versions(current: Record<string,ModelInfo>) {
  const stale: Record<string,{current_major:number;old_versions:string[]}> = {}, families = new Map<string,Map<number,string[]>>();
  for(const [name,info] of Object.entries(current)) {
    const match=/^([a-z-]+?)[-]?(\d+(?:\.\d+)?)(?:-.*)?$/.exec(name); if(!match)continue;
    const key=info.provider+'/'+match[1], versions=families.get(key)??new Map<number,string[]>(),major=Math.trunc(Number(match[2]));
    versions.set(major,[...(versions.get(major)??[]),name]);families.set(key,versions);
  }
  for(const [key,versions] of families)if(versions.size>1){const max=Math.max(...versions.keys());stale[key]={current_major:max,old_versions:[...versions].filter(([major])=>major<max).flatMap(([,names])=>names)};}
  return stale;
}
const heading=(title:string)=>console.log('='.repeat(60)+'\n'+title+'\n'+'='.repeat(60));
export function show_statistics() {
  heading('Model Database Statistics');
  for(const [label,models] of [['Current Models',CURRENT_MODELS],['Deprecated Models',DEPRECATED_MODELS]] as const){console.log(`\n${label}: ${Object.keys(models).length}\n\nBy Provider:`);const counts:Record<string,number>={};for(const info of Object.values(models))counts[info.provider]=(counts[info.provider]??0)+1;for(const name of Object.keys(counts).sort())console.log(`  - ${name}: ${counts[name]}`);}
  console.log(`\nDeprecated Patterns: ${DEPRECATED_PATTERNS.length}\n\nPatterns:`);for(const [pattern,replacement,provider]of DEPRECATED_PATTERNS)console.log(`  - ${pattern.source} -> ${replacement} (${provider})`);console.log('\n'+'='.repeat(60));
}
export function validate_database(current=CURRENT_MODELS,deprecated=DEPRECATED_MODELS): boolean {
  heading('Database Validation');const issues:string[]=[];
  const overlap=Object.keys(current).filter(name=>Object.hasOwn(deprecated,name));if(overlap.length)issues.push('Models in both CURRENT and DEPRECATED: '+overlap.join(', '));
  for(const [name,info]of Object.entries(deprecated)){if(!info.replacement)issues.push(`Deprecated model '${name}' has no replacement`);else if(!Object.hasOwn(current,info.replacement))issues.push(`Replacement '${info.replacement}' for '${name}' not in CURRENT_MODELS`);}
  const stale=detect_stale_versions(current);
  if(issues.length){console.log('\n[ERROR] Critical issues found:');for(const issue of issues)console.log('  - '+issue);}
  if(Object.keys(stale).length){console.log('\n[WARN] Potential stale minor versions detected:');for(const [provider,info]of Object.entries(stale))console.log(`\n  ${provider}:\n    Current major: ${info.current_major}\n    Old versions still in CURRENT: ${JSON.stringify(info.old_versions)}\n    Recommendation: Move old versions to DEPRECATED`);}
  if(!issues.length)console.log(Object.keys(stale).length?'\n[WARN] Validation passed with warnings':'\n[OK] No issues found');return !issues.length;
}
export function generate_update_template(directory=dirname(fileURLToPath(import.meta.url)),today=new Date()): string {
  const date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  const text=`\n# Model Database Update - ${date}\n\n## Research Findings\n\n${['OpenAI','Anthropic','Google'].map(name=>`### ${name}\n- Latest models:\n  -\n- Deprecated:\n  -\n`).join('\n')}\n## Changes to Make\n\n${['Add to CURRENT_MODELS','Move to DEPRECATED_MODELS','Update Patterns (if needed)'].map(name=>'### '+name+'\n```typescript\n\n```\n').join('\n')}\n## New Version Number\nCurrent: 1.0.0\nNew:\n\n## Commit Message\n\`\`\`\nfeat(model-checker): Update model database vX.Y.Z\n\n- Add: ...\n- Deprecate: ...\n\`\`\`\n`;
  const output=join(directory,`update_notes_${date}.md`);writeFileSync(output,text);console.log(`\nUpdate template saved to: ${output}`);return output;
}
export function list_current_models(){heading('Current Models');for(const provider of [...new Set(Object.values(CURRENT_MODELS).map(info=>info.provider))].sort()){console.log(`\n${provider}:`);for(const name of Object.keys(CURRENT_MODELS).filter(name=>CURRENT_MODELS[name].provider===provider).sort())console.log('  - '+name);}}
export function list_deprecated_models(){heading('Deprecated Models');for(const provider of [...new Set(Object.values(DEPRECATED_MODELS).map(info=>info.provider))].sort()){console.log(`\n${provider}:`);for(const name of Object.keys(DEPRECATED_MODELS).filter(name=>DEPRECATED_MODELS[name].provider===provider).sort()){const info=DEPRECATED_MODELS[name];console.log(`  - ${name} -> ${info.replacement} (since ${info.deprecated_date??'unknown'})`);}}}
export function main(argv=process.argv.slice(2)):number{
  if(!argv.length||['--help','-h'].includes(argv[0])){console.log('Model Database Update Helper\n\nUsage: node update_helper.js stats|validate|template|current|deprecated');return 0;}
  if(argv.length!==1)throw new Error('Expected one command');
  switch(argv[0]){case 'stats':show_statistics();return 0;case 'validate':return validate_database()?0:1;case 'template':generate_update_template();return 0;case 'current':list_current_models();return 0;case 'deprecated':list_deprecated_models();return 0;default:throw new Error('Unknown command: '+argv[0]);}
}
if(isMain(import.meta.url)){try{process.exitCode=main();}catch(error){console.error(String(error));process.exitCode=1;}}
