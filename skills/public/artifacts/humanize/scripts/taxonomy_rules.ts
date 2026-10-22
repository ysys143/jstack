import {createHash} from 'node:crypto';
import {read,pyLines} from './_common.js';
export const VALID_CLASSES=new Set(['ANCHORED','COMPUTED','HOLISTIC']);
export const HEADING_RE=/^###\s+([A-Z]{1,2}-\d+)\.\s*(.*?)\s*$/;
export const SEVERITY_RE=/\[(S[123])\]/;
export const normalize=(text:string)=>text.normalize('NFC');
export const content_hash=(raw:string)=>createHash('sha256').update(normalize(raw),'utf8').digest('hex').slice(0,16);
export interface Rule {id:string;name:string;severity:string|null;klass:string|null;surface:string|null;metric:string|null;line:number;}
export interface Taxonomy {version:string|null;content_hash:string;rules:Record<string,Rule>;duplicates:string[];}
export function parse_taxonomy(path:string):Taxonomy{const raw=read(path),lines=pyLines(raw),rules:Record<string,Rule>={},duplicates:string[]=[];let current:Rule|undefined;for(let index=0;index<lines.length;index++){const line=lines[index],heading=HEADING_RE.exec(line);if(heading){const id=heading[1],title=heading[2];current={id,name:title.replace(/\[(S[123])\]/g,'').trim(),severity:SEVERITY_RE.exec(title)?.[1]??null,klass:null,surface:null,metric:null,line:index+1};if(Object.hasOwn(rules,id))duplicates.push(id);rules[id]=current;continue;}if(!current)continue;const klass=/^-\s*class:\s*(ANCHORED|COMPUTED|HOLISTIC)\s*$/.exec(line);if(klass){current.klass=klass[1];continue;}const surface=/^-\s*(?:표층형|surface):\s*(.+?)\s*$/.exec(line);if(surface){let value=surface[1].trim();if(value.startsWith('`')&&value.endsWith('`')&&value.length>=2)value=value.slice(1,-1);current.surface=value.trim();continue;}const metric=/^-\s*(?:지표|metric):\s*(.+?)\s*$/.exec(line);if(metric)current.metric=metric[1].trim();}return{version:/v(\d+\.\d+)/.exec(lines[0]??'')?.[1]??null,content_hash:content_hash(raw),rules,duplicates};}
export const effective_class=(rule:Rule)=>rule.klass||'HOLISTIC';
