import { isMain } from '../../../../../runtime/entry.js';
/**
Lint legacy contract v1 and executable task contract v2.

    node scripts/contract_lint.js .jstack/plan/<slug>/contract.yaml [...]
    node scripts/contract_lint.js --surface FILE --package-root DIR <file>

## Why this runs before verify

`verify` compares the contract with observed work. That comparison is meaningful
only if the contract follows its schema. Missing required fields, misspelled
grades, or unresolved conditional tables produce output resembling a verdict
without establishing one. Therefore verify runs this linter first and does not
begin comparison after a nonzero result.

## Three exit codes

| rc | Meaning |
|---|---|
| 0 | Schema valid; zero package-external path references |
| 1 | Violations: required fields, valid grades, unbaked conditional tables, or package-external paths |
| 2 | Checking could not start: missing file, YAML parse failure, non-mapping root |

Never collapse 2 into 0. Inability to execute and successful checking are
different facts. Sharing an exit code makes a broken environment appear green,
as plugin-generator once did by returning 0 for missing paths (plan §10.9 F-7).

## What is checked

1. Common shape: `계약버전`, `발동`, `산출`, `검증`, and `선행`. Version 2 adds
   task IDs, preparation probes, delegation, and per-requirement user behavior,
   related files, and executable commands, connecting plan to verify.
2. Grade-specific required fields: `기계` requires `명령:` and `RED:`;
   `인간` requires `승인기록:`. Requiring a command for every grade lets an
   unverifiable claim pass with a fabricated command (plan §4.13.5 rule 3).
3. Unbaked conditional tables: table syntax (lines beginning with `|`) remaining
   in a value is a violation. When plan selects a backend, it must select one
   row and resolve it to one value; verify receives one executable command
   (plan §4.13.6).
4. Package-external paths: report a numeric count and return nonzero when the
   count is nonzero. The judge is author/references/package-surface.yaml, which
   already defines package membership; do not duplicate that definition here.

## Identifying path-like values (check 4)

Inspect all string scalars but compare only path-like values with the surface:
values starting with `${CLAUDE_PLUGIN_ROOT}/`, `/`, or a package top-level
name (`skills/`, `commands/`, `agents/`, `hooks/`, `scripts/`, `references/`),
and values containing `../`.

Task output such as `산출: 경로: src/api/login.py` matches none of those four
conditions and is outside this comparison. ../../other-plugin/skills/x/SKILL.md
contains ../ and is checked; matching no surface category makes it a violation.

When the surface declaration is missing, use the explicit fallback judge and
report that fact on stderr. A silent fallback changes the numbers without
revealing that the judge changed.
*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse as parseYaml,parseDocument as parseYamlDocument,isScalar} from 'yaml';
import {lint_link} from '../../verify/scripts/security_contract.js';
import {pyRepr} from '../../../../../scripts/content_contract.js';
export const SCHEMA_VERSION=2,SCHEMA_VERSIONS=[1,2],VALID_TRIGGERS=['모델','사용자'],VALID_GRADES=['기계','인간','불가','미상'],VALID_KINDS=['정적','동적'];
export const PACKAGE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const DEFAULT_SURFACE=path.join(PACKAGE_ROOT,'skills/author/references/package-surface.yaml');
const PREFIXES=['skills/','commands/','agents/','hooks/','scripts/','references/'];
export const FALLBACK_SURFACE_PATTERNS=['skills/*/SKILL.md','skills/*/references/**','skills/*/scripts/**','skills/*/tests/**','skills/*/langs/**','skills/_suite_lib.js','commands/*.md','agents/*.md','hooks/**','scripts/**','.claude-plugin/plugin.json'];
const object=(value:any):value is Record<string,any>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=(value:any):any[]=>Array.isArray(value)?value:[];
const populated=(value:any)=>String(value??'').trim().length>0;
const validId=(value:any)=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
export function glob_to_regex(pattern:string):RegExp{let out='^';for(let i=0;i<pattern.length;){if(pattern.startsWith('**/',i)){out+='(?:[^/]+/)*';i+=3;}else if(pattern.startsWith('**',i)){out+='.*';i+=2;}else if(pattern[i]==='*'){out+='[^/]*';i++;}else if(pattern[i]==='?'){out+='[^/]';i++;}else{out+=pattern[i]!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');i++;}}return new RegExp(out+'$');}
export function load_surface(file?:string):[string[],string]{if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){console.error(`package-surface.yaml is missing (${file}); using the built-in fallback judge`);return [[...FALLBACK_SURFACE_PATTERNS],'fallback'];}try{const data=parseYaml(fs.readFileSync(file,'utf8')),categories=data?.categories??{},patterns=Object.values(categories).flatMap((value:any)=>value??[]);if(!patterns.length||!patterns.every(value=>typeof value==='string'))throw new Error('categories is empty or invalid');return [patterns as string[],file];}catch(error){console.error(`could not read package-surface.yaml (${(error as Error).message}); using the built-in fallback judge`);return [[...FALLBACK_SURFACE_PATTERNS],'fallback'];}}
export function load_contract(file:string):[[Record<string,any>,string]|null,string|null]{if(!fs.existsSync(file)||!fs.statSync(file).isFile())return [null,`contract file does not exist: ${file}`];let text:string;try{text=fs.readFileSync(file,'utf8');}catch(error){return [null,`contract file cannot be read: ${(error as Error).message}`];}if(!text.trim())return [null,`contract file is empty: ${file}`];let data:any;try{const document=parseYamlDocument(text,{version:'1.1'});if(document.errors.length)throw document.errors[0];data=document.toJS();if(Array.isArray(data?.['검증']))data['검증'].forEach((item:any,index:number)=>{for(const field of ['명령','반증']){const node=document.getIn(['검증',index,field,'기대종료'],true);if(isScalar(node)&&typeof node.value==='number'&&/(?:\.|^[+-]?\d[\d_]*[eE])/.test(node.source??''))item[field]['기대종료']=NaN;}});}catch(error){return [null,`could not parse YAML: ${(error as Error).message}`];}if(!object(data))return [null,`contract root is not a mapping: ${file}`];return [[data,text],null];}
export function walk_scalars(node:any,location='$'):[string,string][]{if(object(node))return Object.entries(node).flatMap(([key,value])=>walk_scalars(value,`${location}.${key}`));if(Array.isArray(node))return node.flatMap((value,index)=>walk_scalars(value,`${location}[${index}]`));return typeof node==='string'?[[location,node]]:[];}
export function looks_like_path(value:string):boolean{const text=value.trim();return Boolean(text)&&(text.startsWith('${CLAUDE_PLUGIN_ROOT}/')||text.startsWith('/')||text.includes('../')||PREFIXES.some(prefix=>text.startsWith(prefix)));}
export function normalise_path(value:string):string{const text=value.trim();return text.startsWith('${CLAUDE_PLUGIN_ROOT}/')?text.slice('${CLAUDE_PLUGIN_ROOT}/'.length):text;}
export function check_schema(data:any):string[]{const bad:string[]=[],version=data['계약버전'],trigger=data['발동'];if(version===undefined||version===null)bad.push('`계약버전:` is missing; a contract without a schema version cannot be checked');else if(!SCHEMA_VERSIONS.includes(version))bad.push(`\`계약버전:\` is not supported version 1 or 2: ${pyRepr(version)}`);if(trigger===undefined||trigger===null)bad.push('`발동:` is missing (required)');else if(!VALID_TRIGGERS.includes(trigger))bad.push(`\`발동:\` has an invalid value: ${pyRepr(trigger)} (모델 | 사용자)`);
  for(const field of ['산출','검증'])if(!Array.isArray(data[field])||!data[field].length)bad.push(`\`${field}:\` must be a nonempty list`);
  list(data['산출']).forEach((item,index)=>{if(!object(item)){bad.push(`\`산출[${index}]\` is not a mapping`);return;}for(const field of ['경로','형식'])if(!populated(item[field]))bad.push(`\`산출[${index}].${field}\` is missing (required)`);});
  list(data['검증']).forEach((item,index)=>{if(!object(item)){bad.push(`\`검증[${index}]\` is not a mapping`);return;}const grade=item['등급'];if(grade===undefined||grade===null){bad.push(`\`검증[${index}].등급\` is missing (required)`);return;}if(!VALID_GRADES.includes(grade)){bad.push(`\`검증[${index}].등급\` has an invalid value: ${pyRepr(grade)} (기계 | 인간 | 불가 | 미상)`);return;}if(grade==='기계'&&version===1){if(!populated(item['명령']))bad.push(`\`검증[${index}].명령\` is missing; required for \`등급=기계\``);if(!populated(item.RED))bad.push(`\`검증[${index}].RED\` is missing; required for \`등급=기계\`. A check without RED evidence is not machine-grade`);}else if(grade==='인간'&&version===1&&!populated(item['승인기록']))bad.push(`\`검증[${index}].승인기록\` is missing; required for \`등급=인간\``);});
  if(version===2){if(!validId(data['작업ID']))bad.push('version 2 `작업ID` has an invalid format');if(!['필요','불필요'].includes(data['위임']))bad.push('version 2 `위임` must be `필요` or `불필요`');const prep=data['준비'];if(!Array.isArray(prep)||!prep.length)bad.push('version 2 `준비` is empty');else prep.forEach((item,index)=>{if(!object(item)){bad.push(`준비[${index}] is not a mapping`);return;}for(const field of ['도구','확인명령'])if(typeof item[field]!=='string'||!item[field].trim())bad.push(`준비[${index}].${field} is empty`);});
    const seen=new Set(),reviewKinds=new Set(['사실','평가독립성','SSOT','이식성','cold-read']);list(data['검증']).forEach((item,index)=>{if(!object(item))return;const id=item['요구ID'];if(!validId(id))bad.push(`검증[${index}].요구ID has an invalid format`);else if(seen.has(id))bad.push(`검증[${index}].요구ID is duplicated: ${id}`);else seen.add(id);if(typeof item['사용자행동']!=='string'||!item['사용자행동'].trim())bad.push(`검증[${index}].사용자행동 is empty`);
      const files=item['관련파일'];if(!Array.isArray(files)||!files.length||!files.every(value=>typeof value==='string'&&value.trim()&&!path.isAbsolute(value)&&!value.split('/').includes('..')&&!value.startsWith('.git/')&&!value.startsWith('.jstack/tasks/')))bad.push(`검증[${index}].관련파일 must be a list of relative paths within the repository`);
      for(const field of ['명령','반증']){const command=item[field];if(!object(command)){bad.push(`검증[${index}].${field} is not a mapping`);continue;}if(typeof command['실행']!=='string'||!command['실행'].trim())bad.push(`검증[${index}].${field}.실행 is empty`);if(!Number.isInteger(command['기대종료']))bad.push(`검증[${index}].${field}.기대종료 is not an integer`);}
      if(object(item['반증'])&&!String(item['반증']['실행']??'').includes('{RED_ROOT}'))bad.push(`검증[${index}].반증.실행 must use the temporary-copy placeholder {RED_ROOT}`);if(!['필요','불필요'].includes(item['인간검토']))bad.push(`검증[${index}].인간검토 must be \`필요\` or \`불필요\``);const reviews=item['추가검토']??[];if(!Array.isArray(reviews)){bad.push(`검증[${index}].추가검토 is not a list`);return;}const kinds=new Set();reviews.forEach((review,j)=>{if(!object(review)){bad.push(`검증[${index}].추가검토[${j}] is not a mapping`);return;}const kind=review['종류'],applies=review['적용'];if(!reviewKinds.has(kind))bad.push(`검증[${index}].추가검토[${j}].\`종류\` is invalid`);else if(kinds.has(kind))bad.push(`검증[${index}].추가검토 kind is duplicated: ${kind}`);kinds.add(kind);if(!['필요','생략'].includes(applies))bad.push(`검증[${index}].추가검토[${j}].\`적용\` is invalid`);if(applies==='생략'&&!populated(review['생략사유']))bad.push(`검증[${index}].추가검토[${j}] is missing \`생략사유\``);});
    });
  }
  list(data['선행']).forEach((item,index)=>{if(!object(item)){bad.push(`\`선행[${index}]\` is not a mapping`);return;}if(!populated(item['조건']))bad.push(`\`선행[${index}].조건\` is missing (required)`);const kind=item['유형'];if(kind===undefined||kind===null)bad.push(`\`선행[${index}].유형\` is missing (required)`);else if(!VALID_KINDS.includes(kind))bad.push(`\`선행[${index}].유형\` has an invalid value: ${pyRepr(kind)} (정적 | 동적)`);else if(kind==='동적'&&!populated(item['확인']))bad.push(`\`선행[${index}].확인\` is missing; \`유형=동적\` must not trust state recorded when the contract was written`);});
  const followups=data['후행'];if(followups!==undefined&&followups!==null){if(!Array.isArray(followups))bad.push('`후행:` is not a list');else followups.forEach((value,index)=>{if(typeof value!=='string'||!value.trim())bad.push(`\`후행[${index}]\` is not a skill-name string: ${pyRepr(value)}`);});}if(data['보안검증']!==undefined&&data['보안검증']!==null)bad.push(...lint_link(data));return bad;
}
export function check_unbaked_tables(data:any,text:string):string[]{const bad:string[]=[];for(const[where,value]of walk_scalars(data))for(const line of value.split(/\r?\n/))if(line.trim().startsWith('|')){bad.push(`${where} contains table syntax: ${pyRepr(line.trim().slice(0,60))} — conditional tables must be resolved to one value before entering the contract`);break;}text.split(/\r?\n/).forEach((line,index)=>{const value=line.trim();if(value.startsWith('|')&&value.split('|').length-1>=2)bad.push(`line ${index+1} contains table syntax: ${pyRepr(value.slice(0,60))}; the contract is unbaked`);});return bad;}
export function check_outside_refs(data:any,patterns:string[]):[string[],number]{const regexes=patterns.map(glob_to_regex),bad:string[]=[];let examined=0;for(const[where,value]of walk_scalars(data)){if(data['계약버전']===2&&(/^\$\.산출\[\d+\]\.경로$/.test(where)||/^\$\.검증\[\d+\]\.관련파일\[\d+\]$/.test(where)))continue;if(!looks_like_path(value))continue;examined++;if(!regexes.some(regex=>regex.test(normalise_path(value))))bad.push(`${where} points outside the package: ${pyRepr(value)} — it matches no surface category`);}return [bad,examined];}
export function lint(file:string,patterns:string[],judge:string,quiet=false):[number,number,number]{const[loaded,error]=load_contract(file);if(error||!loaded){console.error(error);return [2,0,0];}const[data,text]=loaded,bad=[...check_schema(data),...check_unbaked_tables(data,text)],[outside,examined]=check_outside_refs(data,patterns);bad.push(...outside);if(bad.length){console.error(`${file} — violations: ${bad.length}:\n`+bad.map(value=>'  '+value).join('\n'));return [1,bad.length,outside.length];}if(!quiet)console.log(`${file} — violations: 0 · package-external path references 0 (checked ${examined} path-like values) · judge ${judge}`);return [0,0,0];}
export function main(argv:string[]):number{const contracts:string[]=[];let surface=DEFAULT_SURFACE,quiet=false;for(let i=0;i<argv.length;i++){const arg=argv[i]!;if(arg==='--quiet')quiet=true;else if((arg==='--surface'||arg==='--package-root')&&argv[i+1]){if(arg==='--surface')surface=argv[++i]!;else i++;}else if(arg.startsWith('--'))return 2;else contracts.push(arg);}if(!contracts.length){console.error('no contract files were provided; checking zero files is not a pass');return 2;}const[patterns,judge]=load_surface(surface);let rc=0,violations=0,outside=0;for(const file of contracts){const[code,nv,no]=lint(file,patterns,judge,quiet);rc=Math.max(rc,code);violations+=nv;outside+=no;}if(rc!==2&&!quiet)console.log(`contracts ${contracts.length} · violations ${violations} · package-external path references ${outside} · judge ${judge}`);return rc;}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
