import { isMain } from '../runtime/entry.js';
/** Content anchors and independently recorded semantic review; hashes do not authenticate reviewers. */
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const NUMBER=/(?<![A-Za-z0-9])\p{Nd}+(?:[,.]\p{Nd}+)?(?:%|년|월|일|시간|개|건|명|회)?/gu;
const NAME=/(?<![A-Za-z0-9])[A-Z][A-Za-z0-9_-]{2,}(?![A-Za-z0-9])/g;
const REQ=/\b(?:RFP|REQ|SFR|CNR|PER)-?[A-Z0-9-]*\d[A-Z0-9-]*\b/g;
const QUOTE=/(?:"([^"]+)"|“([^”]+)”|「([^」]+)」|『([^』]+)』)/g;
const NEG=/않|못|없|아니|불가|실패|미확인|미정|입증하지|단정할 수 없|불가능|미지원|미충족|미검증/g;
const STRONG=/항상|모든 환경|전부|100%|무조건|보장|입증했다|증명했다|확정적|무제한|업계 최고|완벽|확실히|명백히|완전히|전적으로|예외 없이|문제없이|성공적으로|검증됐다|검증됨|확인됐다|완료됐다|완료됨|정상 작동/g;
const CONTRADICTIONS=[['암호화','평문'],['관찰했다','관찰하지 못했다'],['성공','실패'],['가능','불가능'],['보존','삭제'],['확정','탐색적'],['증가','감소'],['개선','악화'],['허용','차단'],['포함','제외'],['지원','미지원'],['유지','변경'],['일치','불일치'],['검증','미검증'],['필수','선택'],['충족','미충족'],['승인','거부'],['공개','비공개']];
const STOP=new Set(['및','있는','있다','한다','하는','대한','대해','에서','으로','것을','것은']);
const FREEFORM=new Set(['description','details','rationale','notes','explanation']);
const unique=(values:string[])=>[...new Set(values)].sort();
const object=(value:unknown):value is Record<string,any>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const matches=(text:string,re:RegExp)=>[...text.matchAll(re)].map(match=>match[0]);
class PythonFloat {
  constructor(readonly value:number){}
  toString():string{
    if(!Number.isFinite(this.value))return this.value===Infinity?'inf':this.value===-Infinity?'-inf':'nan';
    if(Object.is(this.value,-0))return '-0.0';
    const absolute=Math.abs(this.value);let text=absolute!==0&&(absolute<1e-4||absolute>=1e16)?this.value.toExponential():String(this.value);
    if(text.includes('e'))return text.replace(/e([+-]?)(\d+)$/,(_match,sign,digits)=>'e'+(sign||'+')+digits.padStart(2,'0'));
    return text.includes('.')?text:text+'.0';
  }
}
export function pyRepr(value:any):string {
  if(value instanceof PythonFloat)return value.toString();
  if(value===null||value===undefined)return 'None';if(value===true)return 'True';if(value===false)return 'False';
  if(typeof value==='string'){const quote=value.includes("'")&&!value.includes('"')?'"':"'";return quote+value.replaceAll('\\','\\\\').replaceAll(quote,'\\'+quote).replaceAll('\n','\\n').replaceAll('\r','\\r').replaceAll('\t','\\t')+quote;}
  if(Array.isArray(value))return '['+value.map(pyRepr).join(', ')+']';
  if(object(value))return '{'+Object.entries(value).map(([key,val])=>pyRepr(key)+': '+pyRepr(val)).join(', ')+'}';return String(value);
}
export const norm=(value:any)=>(typeof value==='string'?value:pyRepr(value)).replace(/\s+/g,' ').trim();
export const sha256=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function anchors(text:string){return {numbers:matches(text,NUMBER),names:unique([...matches(text,NAME),...matches(text,REQ)]),quotes:[...text.matchAll(QUOTE)].map(match=>match.slice(1).find(value=>value!==undefined)!)};}
export function counterMissing(before:string[],after:string[]):string[]{const counts=new Map<string,number>();for(const value of before)counts.set(value,(counts.get(value)??0)+1);for(const value of after)counts.set(value,(counts.get(value)??0)-1);return [...counts].flatMap(([value,count])=>Array(Math.max(0,count)).fill(value));}
export function machineTextCheck(before:string,after:string):any{
  const left=anchors(before),right=anchors(after),failures:string[]=[],review_flags:string[]=[];
  for(const key of ['numbers','names','quotes'] as const){const missing=counterMissing(left[key],right[key]);if(missing.length)failures.push(`${key}-changed:${pyRepr(missing)}`);}
  if(matches(before,NEG).length!==matches(after,NEG).length)review_flags.push('negation-changed');
  const added=counterMissing(matches(after,STRONG),matches(before,STRONG));if(added.length)review_flags.push(`claim-strength-added:${pyRepr(added)}`);
  for(const [positive,negative] of CONTRADICTIONS){if(after.includes(negative!)&&!before.includes(negative!))review_flags.push(`semantic-polarity-added:${negative}`);if(after.includes(positive!)&&!before.includes(positive!)&&before.includes(negative!))review_flags.push(`semantic-polarity-reversed:${positive}`);}
  return {before:left,after:right,failures,review_flags:unique(review_flags),review_required:Boolean(failures.length||review_flags.length)||before!==after};
}
function procurementSchema(value:any,label:string):string[]{
  if(!object(value))return [`${label}-schema:not-object`];const failures:string[]=[];
  if(!Array.isArray(value.requirements)||!value.requirements.length)failures.push(`${label}-schema:requirements-missing-or-empty`);
  else value.requirements.forEach((item:any,index:number)=>{if(!object(item))failures.push(`${label}-schema:requirement-${index}-not-object`);else if(typeof item.id!=='string'||!item.id.trim())failures.push(`${label}-schema:requirement-${index}-id-missing`);});
  for(const key of ['commitments','evidence','unknowns'])if(key in value&&!Array.isArray(value[key]))failures.push(`${label}-schema:${key}-not-list`);return failures;
}
const sameSet=(a:string[],b:string[])=>JSON.stringify(unique(a))===JSON.stringify(unique(b));
const terms=(value:any)=>matches(norm(value),/[A-Za-z0-9]+|[가-힣]{2,}/g).filter(token=>!STOP.has(token));
const fieldAnchors=(value:any)=>[...matches(norm(value),NUMBER),...unique(matches(norm(value),NAME))];
export function procurementCheck(before:any,after:any):any{
  const failures=[...procurementSchema(before,'source'),...procurementSchema(after,'output')],review_flags:string[]=[];
  if(failures.length)return {failures:unique(failures),review_flags:[],review_required:true};
  const sourceIds=before.requirements.map((item:any)=>norm(item.id)),resultIds=after.requirements.map((item:any)=>norm(item.id));
  if(sourceIds.length!==new Set(sourceIds).size)failures.push('source-duplicate-requirement-id');if(resultIds.length!==new Set(resultIds).size)failures.push('output-duplicate-requirement-id');if(!sameSet(sourceIds,resultIds))failures.push('requirement-id-set-changed');
  const byId=new Map<string,any>(after.requirements.map((item:any)=>[norm(item.id),item]));
  for(const item of before.requirements){const rid=norm(item.id),got=byId.get(rid);if(!got)continue;if(!sameSet(Object.keys(got),Object.keys(item)))failures.push(`requirement-fields-changed:${rid}`);
    for(const [key,source]of Object.entries(item)){if(key==='id')continue;const target=got[key];if(!FREEFORM.has(key)&&norm(source)!==norm(target)||counterMissing(fieldAnchors(source),fieldAnchors(target)).length)failures.push(`requirement-value-changed:${rid}:${key}`);
      if(counterMissing(terms(source),terms(target)).length)review_flags.push(`requirement-content-changed:${rid}:${key}`);
      for(const [positive,negative]of CONTRADICTIONS)if(norm(source).includes(positive!)&&norm(target).includes(negative!)||norm(source).includes(negative!)&&norm(target).includes(positive!))review_flags.push(`requirement-strength-changed:${rid}:${key}`);
    }
  }
  for(const key of ['commitments','evidence','unknowns']){const source=(before[key]??[]).map(norm),result=(after[key]??[]).map(norm);if(['evidence','commitments'].includes(key)&&(counterMissing(source,result).length||counterMissing(result,source).length))failures.push('evidence-set-changed');else if(key==='unknowns'&&counterMissing(source,result).length)failures.push('unknown-removed');}
  return {failures:unique(failures),review_flags:unique(review_flags),review_required:true};
}
export function propositions(text:string){return text.split(/(?<=[.!?。！？])\s*/).map(s=>s.trim()).filter(Boolean).map((source,index)=>({id:`p-${String(index+1).padStart(3,'0')}`,source}));}
export function reviewCheck(reviewPath:string|undefined,beforePath:string,afterPath:string,sourceText:string,afterText:string):any{
  const provisional=(failures:string[])=>({status:'provisional',review_required:true,failures:unique(failures)});
  if(!reviewPath)return fs.readFileSync(beforePath).equals(fs.readFileSync(afterPath))?{status:'unchanged',review_required:false,failures:[]}:provisional(['review-missing']);
  let review:any;try{review=JSON.parse(fs.readFileSync(reviewPath,'utf8'));}catch(error){return provisional([`review-unreadable:${(error as Error).message}`]);}if(!object(review))return provisional(['review-schema']);
  const failures:string[]=[];if(review.beforeSha256!==sha256(beforePath))failures.push('review-before-hash');if(review.afterSha256!==sha256(afterPath))failures.push('review-after-hash');
  const expected=new Map(propositions(sourceText).map(row=>[row.id,row.source]));const rows=Array.isArray(review.coverage)?review.coverage.filter(object):[];const ids=rows.map((row:any)=>row.propositionId);const got=new Map<any,any>(rows.map((row:any)=>[row.propositionId,row]));
  if(ids.length!==new Set(ids).size||!sameSet([...got.keys()],[...expected.keys()]))failures.push('review-proposition-coverage');
  for(const [id,row]of got){if(!['verified','changed','uncertain'].includes(row.status))failures.push(`review-status:${id}`);else if(row.status!=='verified')failures.push(`review-${row.status}:${id}`);
    const spans=row.evidenceSpans;if(!Array.isArray(spans)||!spans.length||spans.some(span=>!object(span)))failures.push(`review-evidence-spans:${id}`);else for(const span of spans){if(typeof span.source!=='string'||typeof span.output!=='string')failures.push(`review-evidence-shape:${id}`);else if(!span.source.trim()||!span.output.trim()||!(expected.get(id)??'').includes(span.source)||!afterText.includes(span.output))failures.push(`review-evidence-mismatch:${id}`);}
  }
  if(!['external-artifact','unverified'].includes(review.independence))failures.push('review-independence-field');else if(review.independence==='unverified')failures.push('review-independence-unverified');
  return failures.length?provisional(failures):{status:'reviewed',review_required:false,failures:[],independence:review.independence,trustBoundary:"external-artifact records the trusted coordinator's observation of a separate review; hashes and this field do not authenticate a reviewer"};
}
const readText=(file:string)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(file)).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
/** Preserve integer tokens that JSON.parse would round before comparing obligations. */
export function parseDocument(text:string):any{
  let prefix='__jstack_integer_';while(text.includes(prefix))prefix+='x';const values=new Map<string,bigint|PythonFloat>();
  const rewritten=text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,token=>{
    if(token.startsWith('"')||!/[.eE]/.test(token)&&Number.isSafeInteger(Number(token)))return token;
    const key=prefix+values.size;values.set(key,/[.eE]/.test(token)?new PythonFloat(Number(token)):BigInt(token));return JSON.stringify(key);
  });return JSON.parse(rewritten,(_key,value)=>typeof value==='string'&&values.has(value)?values.get(value):value);
}
export function evaluate(beforePath:string,afterPath:string,mode='general',reviewPath?:string):any{
  const before=readText(beforePath),after=readText(afterPath);let machine:any;
  if(mode==='procurement'){try{machine=procurementCheck(parseDocument(before),parseDocument(after));}catch(error){machine={failures:[`json-invalid:${(error as Error).message}`],review_required:true};}}else machine=machineTextCheck(before,after);
  const review=reviewCheck(reviewPath,beforePath,afterPath,before,after),textFlags=mode==='procurement'?machineTextCheck(before,after).review_flags:[];
  const reviewFlags=unique([...(machine.review_flags??[]),...textFlags]);let failures=unique([...machine.failures,...review.failures]);
  if(reviewFlags.length){review.flags=reviewFlags;if(review.status!=='reviewed'){review.review_required=true;review.status='provisional';review.failures=unique([...review.failures,...reviewFlags]);failures=unique([...failures,...reviewFlags]);}}
  return {schemaVersion:1,status:machine.failures.length?'rejected':review.status,accepted:!failures.length&&['reviewed','unchanged'].includes(review.status),provisional:Boolean(review.review_required),beforeSha256:sha256(beforePath),afterSha256:sha256(afterPath),mode,machine,reviewFlags,review,failures};
}
export function main(argv:string[]):number{const values:Record<string,string>={};for(let i=0;i<argv.length;i++){const key=argv[i]!;if(key==='--json')continue;if(!['--before','--after','--mode','--review'].includes(key)||!argv[i+1]||argv[i+1]!.startsWith('--')){console.error('usage: content_contract --before FILE --after FILE [--mode general|procurement] [--review FILE] [--json]');return 2;}values[key]=argv[++i]!;}
  if(!values['--before']||!values['--after']||!['general','procurement'].includes(values['--mode']??'general')){console.error('before, after and a valid mode are required');return 2;}let result:any;try{result=evaluate(values['--before'],values['--after'],values['--mode'],values['--review']);}catch(error){result={schemaVersion:1,status:'unmeasured',accepted:false,provisional:true,failures:[(error as Error).message]};}console.log(JSON.stringify(result,null,2));return result.accepted?0:result.status==='rejected'?1:2;}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
