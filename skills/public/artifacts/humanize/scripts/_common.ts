import { isMain } from '../../../../../runtime/entry.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const pyLen=(text:string)=>[...text].length;
export const pyLines=(text:string)=>text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).filter((value,index,array)=>index<array.length-1||value!=='');
export const read=(path:string)=>readFileSync(path,'utf8').replace(/\r\n|\r/g,'\n');
export const count=(text:string,needle:string)=>needle?text.split(needle).length-1:pyLen(text)+1;
export const mean=(values:number[])=>values.length?values.reduce((total,value)=>total+value,0)/values.length:0;
export function pyRound(value:number,digits:number):number {
    if(!Number.isFinite(value)||value===0)return value;
    const bytes=Buffer.alloc(8);bytes.writeDoubleBE(Math.abs(value));const bits=bytes.readBigUInt64BE(),exponent=Number((bits>>52n)&0x7ffn),mantissa=(bits&((1n<<52n)-1n))+(exponent?1n<<52n:0n),power=(exponent||1)-1023-52;
    let numerator=mantissa*10n**BigInt(digits),denominator=1n;if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);
    let rounded=numerator/denominator;const remainder=numerator%denominator;if(remainder*2n>denominator||(remainder*2n===denominator&&rounded%2n===1n))rounded++;
    const result=Number(rounded)/10**digits;return value<0?-result:result;
}
export function surfaceRegex(input:string,global=false):RegExp {
    let pattern=input,flags=global?'gu':'u';const leading=/^\(\?([aiLmsux]+)\)/.exec(pattern);if(leading){for(const flag of leading[1]){if('ims'.includes(flag)&&!flags.includes(flag))flags+=flag;if('Lx'.includes(flag))throw Error(`Unsupported surface regex flag: ${flag}`);}pattern=pattern.slice(leading[0].length);}
    pattern=pattern.replace(/\(\?P<([A-Za-z_]\w*)>/g,'(?<$1>').replace(/\(\?P=([A-Za-z_]\w*)\)/g,'\\k<$1>');
    let output='',inside=false;const word='[\\p{L}\\p{N}_]';
    for(let index=0;index<pattern.length;index++){const char=pattern[index];if(char==='\\'&&index+1<pattern.length){const next=pattern[++index];if(next==='U'){const code=pattern.slice(index+1,index+9);if(!/^[0-9a-fA-F]{8}$/.test(code)||parseInt(code,16)>0x10ffff)throw new SyntaxError('Invalid Unicode code point escape: '+code);output+='\\u{'+parseInt(code,16).toString(16)+'}';index+=8;}else if(next==='b'&&!inside&&!leading?.[1].includes('a'))output+=`(?:(?<!${word})(?=${word})|(?<=${word})(?!${word}))`;else if(next==='B'&&!inside&&!leading?.[1].includes('a'))output+=`(?:(?<=${word})(?=${word})|(?<!${word})(?!${word}))`;else if(next==='w'&&!leading?.[1].includes('a'))output+=inside?'\\p{L}\\p{N}_':word;else if(next==='W'&&!inside&&!leading?.[1].includes('a'))output+='[^\\p{L}\\p{N}_]';else if(next==='d'&&!leading?.[1].includes('a'))output+='\\p{Nd}';else if(next==='s')output+=inside?'\\s\\x85\\x1c-\\x1f':'[\\s\\x85\\x1c-\\x1f]';else if(next==='A'&&!inside)output+='^';else if(next==='Z'&&!inside)output+='(?![\\s\\S])';else output+='\\'+next;continue;}if(char==='[')inside=true;if(char===']')inside=false;output+=char;}
    return new RegExp(output,flags);
}
export function args(argv:string[],allowed:string[],required:string[]=[]):Record<string,string>{const out:Record<string,string>={};for(let index=0;index<argv.length;index++){const key=argv[index];if(key==='--help'||key==='-h'){out.help='1';continue;}if(!allowed.includes(key)||index+1>=argv.length)throw Error('Invalid argument: '+key);out[key.slice(2)]=argv[++index];}if(!out.help)for(const key of required)if(!out[key])throw Error('Missing --'+key);return out;}
export function writeJson(path:string,value:unknown,parents=false):void{if(parents)mkdirSync(dirname(resolve(path)),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2));}
export function entry(url:string,main:(argv:string[])=>number):void{if(isMain(url)){try{process.exitCode=main(process.argv.slice(2));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=2;}}}
