/** Native text/container utilities for the migrated owning suites. No foreign runtime. */
import { statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
export function truth(value:any):boolean { if(value==null)return false;if(typeof value==='string'||Array.isArray(value))return value.length>0;if(value instanceof Set||value instanceof Map)return value.size>0;if(typeof value==='object')return Object.keys(value).length>0;return Boolean(value); }
export function length(value:any):number { if(typeof value==='string')return [...value].length;return value instanceof Set||value instanceof Map?value.size:Array.isArray(value)?value.length:Object.keys(value).length; }
export function contains(container:any,value:any):boolean { if(container instanceof Set||container instanceof Map)return container.has(value)||[...container.keys()].some(key=>isDeepStrictEqual(key,value));if(Array.isArray(container))return container.some(item=>isDeepStrictEqual(item,value));if(typeof container==='string')return container.includes(value);return Object.hasOwn(container,value); }
export function unique(value:Iterable<any>=[]):any[]{return [...new Set(value)];}
export function sorted(value:any):any[]{return (value instanceof Set||Array.isArray(value)||typeof value==='string'?[...value]:Object.keys(value)).sort((left:any,right:any)=>{if(typeof left==='number'&&typeof right==='number')return left-right;const a=[...String(left)],b=[...String(right)];for(let i=0;i<Math.min(a.length,b.length);i++){const delta=a[i].codePointAt(0)!-b[i].codePointAt(0)!;if(delta)return delta;}return a.length-b.length;});}
export function repr(value:any):string { if(value===null||value===undefined)return 'None';if(typeof value==='boolean')return value?'True':'False';if(typeof value==='object')return JSON.stringify(value);return String(value); }
export function at(value:any,key:any):any { if(typeof value==='string')return [...value].at(key);if(Array.isArray(value)&&typeof key==='number')return value.at(key);return value[key]; }
export function slice(value:any,start=0,end?:number):any { return typeof value==='string'?[...value].slice(start,end).join(''):value.slice(start,end); }
const SPACE_CONTENT='\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const SPACE_ONLY=new RegExp('^['+SPACE_CONTENT+']$','u');
function stripSide(value:string,chars:string|undefined,left:boolean,right:boolean):string{const points=[...value],set=chars===undefined?null:new Set(chars),matches=(point:string)=>set?set.has(point):SPACE_ONLY.test(point);let start=0,end=points.length;if(left)while(start<end&&matches(points[start]))start++;if(right)while(end>start&&matches(points[end-1]))end--;return points.slice(start,end).join('');}
export function strip(value:string,chars?:string):string{return stripSide(value,chars,true,true);}
export function lstrip(value:string,chars?:string):string{return stripSide(value,chars,true,false);}
export function rstrip(value:string,chars?:string):string{return stripSide(value,chars,false,true);}
export function split(value:string,sep?:string,max?:number):string[]{
 if(sep==='')throw Error('empty separator');
 if(sep!==undefined){const parts=value.split(sep);return max===undefined||max<0||parts.length<=max+1?parts:[...parts.slice(0,max),parts.slice(max).join(sep)];}
 const input=lstrip(value);if(!input)return[];if(max===0)return[input];const separators=[...input.matchAll(new RegExp('['+SPACE_CONTENT+']+','gu'))],out:string[]=[];let start=0;
 for(const separator of separators){if(max!==undefined&&max>=0&&out.length>=max)break;out.push(input.slice(start,separator.index));start=separator.index!+separator[0].length;}
 if(start<input.length)out.push(input.slice(start));return out;
}
export function lines(value:string):string[]{return value.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).filter((line,i,all)=>i<all.length-1||line!=='');}
export function count(value:any,needle:any):number{if(Array.isArray(value))return value.filter(item=>isDeepStrictEqual(item,needle)).length;return needle===''?[...value].length+1:value.split(needle).length-1;}
export function starts(value:string,prefix:string|string[]):boolean{return Array.isArray(prefix)?prefix.some(p=>value.startsWith(p)):value.startsWith(prefix);}
export function ends(value:string,suffix:string|string[]):boolean{return Array.isArray(suffix)?suffix.some(p=>value.endsWith(p)):value.endsWith(suffix);}
export function lower(value:string):string{return value.toLowerCase();}
export function joinText(sep:string,value:Iterable<any>):string{return [...value].join(sep);}
export function replace(value:string,from:string,to:string):string{return value.replaceAll(from,to);}
function regex(pattern:string,global=false):RegExp {
 let modifiers='';pattern=pattern.replace(/^\(\?([ims]+)\)/,(_,added:string)=>{modifiers+=added;return '';});
 const multiline=modifiers.includes('m'),dotAll=modifiers.includes('s'),word='[\\p{L}\\p{N}_]';let out='',inClass=false;
 // Keep the source patterns' Unicode word/space and LF-only anchor contracts
 // while executing ordinary JavaScript RegExp objects on Node.
 for(let i=0;i<pattern.length;i++){
  const ch=pattern[i];
  if(pattern.slice(i,i+6)==='[\\s\\S]'){out+='[\\s\\S]';i+=5;continue;}
  if(ch==='\\'){
   const next=pattern[++i];
   if(next==='w'){out+=inClass?'\\p{L}\\p{N}_':word;continue;}
   if(next==='W'&&!inClass){out+='[^\\p{L}\\p{N}_]';continue;}
   if(next==='d'||next==='D'){out+=next==='d'?'\\p{Nd}':'\\P{Nd}';continue;}
   if(next==='s'){out+=inClass?SPACE_CONTENT:'['+SPACE_CONTENT+']';continue;}
   if(next==='S'&&!inClass){out+='[^'+SPACE_CONTENT+']';continue;}
   if(next==='b'&&!inClass){out+='(?:(?<='+word+')(?!'+word+')|(?<!'+word+')(?='+word+'))';continue;}
   if(next==='B'&&!inClass){out+='(?:(?<='+word+')(?='+word+')|(?<!'+word+')(?!'+word+'))';continue;}
   if(next==='A'&&!inClass){out+='(?<![\\s\\S])';continue;}
   if(next==='Z'&&!inClass){out+='(?![\\s\\S])';continue;}
   out+='\\'+next;continue;
  }
  if(ch==='[')inClass=true;else if(ch===']')inClass=false;
  if(!inClass&&ch==='.')out+=dotAll?'[\\s\\S]':'[^\\n]';
  else if(!inClass&&ch==='^')out+=multiline?'(?:(?<=\\n)|(?<![\\s\\S]))':'(?<![\\s\\S])';
  else if(!inClass&&ch==='$')out+=multiline?'(?=\\n|(?![\\s\\S]))':'(?=\\n?(?![\\s\\S]))';
  else out+=ch;
 }
 return new RegExp(out,(global?'g':'')+(modifiers.includes('i')?'i':'')+'u');
}
export function findall(pattern:string,text:string):any[]{return [...text.matchAll(regex(pattern,true))].map(m=>m.length===1?m[0]:m.length===2?(m[1]??''):m.slice(1).map(value=>value??''));}
export function finditer(pattern:string,text:string):RegExpMatchArray[]{return [...text.matchAll(regex(pattern,true))];}
export function search(pattern:string,text:string):RegExpMatchArray|null{return regex(pattern).exec(text);}
export function match(pattern:string,text:string):RegExpMatchArray|null{const result=regex(pattern).exec(text);return result?.index===0?result:null;}
export function group(result:RegExpMatchArray,index:number):string{return result[index];}
export function sub(pattern:string,replacement:string,text:string):string{return text.replace(regex(pattern,true),replacement.replace(/\\(\d+)/g,'$$$1'));}
export function isdir(path:string):boolean{try{return statSync(path).isDirectory();}catch{return false;}}
export function isinstance(value:any,type:string):boolean{return type==='dict'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='int'?Number.isInteger(value):type==='str'?typeof value==='string':type==='list'?Array.isArray(value):false;}
export function temporaryDirectory():string{return mkdtempSync(join(tmpdir(),'jstack-owning-suite-'));}
export function removeTree(path:string,_options?:unknown):void{rmSync(path,{recursive:true,force:true});}
export function range(stop:number):number[]{return Array.from({length:stop},(_,i)=>i);}
export function isdigit(value:string):boolean{return /^\p{Nd}+$/u.test(value);}
export function enumerate(value:Iterable<any>):[number,any][]{return [...value].map((entry,index)=>[index,entry]);}
